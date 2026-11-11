(() => {
  'use strict';

  const FORMAT='north-assembly-new-world-encrypted-backup';
  const VERSION=1;
  const PBKDF2_ITERATIONS=310000;
  const MIN_PASSPHRASE_LENGTH=12;
  const MAX_BACKUP_BYTES=50*1024*1024;
  const encoder=new TextEncoder();

  function cryptoApiFor(candidate) {
    const api=candidate||globalThis.crypto;
    if(!api?.subtle||typeof api.getRandomValues!=='function')
      throw new Error('Web Crypto is unavailable. Open New World in a secure browser context (HTTPS or localhost).');
    return api;
  }

  function validatePassphrase(value) {
    if(typeof value!=='string'||value.length<MIN_PASSPHRASE_LENGTH||value.length>1024)
      throw new Error('The backup password must contain 12–1,024 characters.');
    return value;
  }

  function toBase64(bytes) {
    let binary='';
    for(let offset=0;offset<bytes.length;offset+=0x8000)
      binary+=String.fromCharCode(...bytes.subarray(offset,Math.min(offset+0x8000,bytes.length)));
    return btoa(binary);
  }

  function fromBase64(value,maximumBytes) {
    if(typeof value!=='string'||value.length<4||value.length>Math.ceil(maximumBytes/3)*4+4||
       !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
      throw new Error('The encrypted backup contains invalid or oversized binary data.');
    let binary;
    try { binary=atob(value); }
    catch { throw new Error('The encrypted backup contains invalid Base64 data.'); }
    if(binary.length>maximumBytes)
      throw new Error('The encrypted backup exceeds the permitted size.');
    return Uint8Array.from(binary,char=>char.charCodeAt(0));
  }

  function validateEnvelope(envelope) {
    if(!envelope||typeof envelope!=='object'||Array.isArray(envelope)||
       envelope.format!==FORMAT||envelope.version!==VERSION||
       envelope.kdf?.name!=='PBKDF2'||envelope.kdf?.hash!=='SHA-256'||
       envelope.kdf?.iterations!==PBKDF2_ITERATIONS||
       envelope.cipher?.name!=='AES-GCM'||envelope.cipher?.length!==256||
       typeof envelope.createdAt!=='string'||!Number.isFinite(Date.parse(envelope.createdAt)))
      return {valid:false,reason:'BACKUP_FORMAT_INVALID'};
    try {
      const salt=fromBase64(envelope.salt,32);
      const iv=fromBase64(envelope.iv,16);
      const ciphertext=fromBase64(envelope.ciphertext,MAX_BACKUP_BYTES+32);
      if(salt.length!==16||iv.length!==12||ciphertext.length<17)
        return {valid:false,reason:'BACKUP_CRYPTO_PARAMETERS_INVALID'};
      return {valid:true,salt,iv,ciphertext};
    } catch(error) {
      return {valid:false,reason:'BACKUP_BINARY_INVALID',error:error.message};
    }
  }

  async function deriveKey(passphrase,salt,cryptoApi) {
    const material=await cryptoApi.subtle.importKey(
      'raw',encoder.encode(passphrase),'PBKDF2',false,['deriveKey']);
    return cryptoApi.subtle.deriveKey({
      name:'PBKDF2',salt,iterations:PBKDF2_ITERATIONS,hash:'SHA-256'
    },material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }

  async function encrypt(plaintext,passphrase,cryptoCandidate) {
    validatePassphrase(passphrase);
    if(typeof plaintext!=='string')
      throw new Error('Only a serialized text backup can be encrypted.');
    const data=encoder.encode(plaintext);
    if(!data.length||data.length>MAX_BACKUP_BYTES)
      throw new Error('The backup is empty or exceeds the 50 MB export limit.');
    const cryptoApi=cryptoApiFor(cryptoCandidate);
    const salt=cryptoApi.getRandomValues(new Uint8Array(16));
    const iv=cryptoApi.getRandomValues(new Uint8Array(12));
    const key=await deriveKey(passphrase,salt,cryptoApi);
    const additionalData=encoder.encode(FORMAT+':'+VERSION);
    const encrypted=await cryptoApi.subtle.encrypt({
      name:'AES-GCM',iv,additionalData,tagLength:128
    },key,data);
    return {
      format:FORMAT,version:VERSION,
      createdAt:new Date().toISOString(),
      kdf:{name:'PBKDF2',hash:'SHA-256',iterations:PBKDF2_ITERATIONS},
      cipher:{name:'AES-GCM',length:256},
      salt:toBase64(salt),iv:toBase64(iv),
      ciphertext:toBase64(new Uint8Array(encrypted))
    };
  }

  async function decrypt(envelope,passphrase,cryptoCandidate) {
    validatePassphrase(passphrase);
    const checked=validateEnvelope(envelope);
    if(!checked.valid)
      throw new Error('The selected file is not a supported New World encrypted backup ('+checked.reason+').');
    const cryptoApi=cryptoApiFor(cryptoCandidate);
    try {
      const key=await deriveKey(passphrase,checked.salt,cryptoApi);
      const plaintext=await cryptoApi.subtle.decrypt({
        name:'AES-GCM',iv:checked.iv,
        additionalData:encoder.encode(FORMAT+':'+VERSION),tagLength:128
      },key,checked.ciphertext);
      return new TextDecoder('utf-8',{fatal:true}).decode(plaintext);
    } catch {
      throw new Error('The password is incorrect or the backup file has been modified.');
    }
  }

  const api=Object.freeze({
    encrypt,decrypt,validateEnvelope,format:FORMAT,version:VERSION,
    pbkdf2Iterations:PBKDF2_ITERATIONS,
    minimumPassphraseLength:MIN_PASSPHRASE_LENGTH,
    maximumBackupBytes:MAX_BACKUP_BYTES
  });
  globalThis.NewWorldPortableBackup=api;
  if(typeof window!=='undefined') window.NewWorldPortableBackup=api;
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
})();
