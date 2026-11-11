'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const backup=require('../portable-backup.js');

const passphrase='New World portable backup 2026!';

test('portable host backups use an authenticated AES-256-GCM envelope and PBKDF2 parameters',async()=>{
  const value=JSON.stringify({worldId:'world-test',hostToken:'secret-token',day:42});
  const encrypted=await backup.encrypt(value,passphrase,webcrypto);
  assert.equal(encrypted.format,backup.format);
  assert.equal(encrypted.version,1);
  assert.equal(encrypted.kdf.name,'PBKDF2');
  assert.equal(encrypted.kdf.hash,'SHA-256');
  assert.equal(encrypted.kdf.iterations,310000);
  assert.equal(encrypted.cipher.name,'AES-GCM');
  assert.equal(encrypted.cipher.length,256);
  assert.equal(backup.validateEnvelope(encrypted).valid,true);
  assert.equal(await backup.decrypt(encrypted,passphrase,webcrypto),value);
  assert.notEqual(encrypted.salt,encrypted.iv);
});

test('portable backup encryption creates independent salts and nonces for every export',async()=>{
  const first=await backup.encrypt('same content',passphrase,webcrypto);
  const second=await backup.encrypt('same content',passphrase,webcrypto);
  assert.notEqual(first.salt,second.salt);
  assert.notEqual(first.iv,second.iv);
  assert.notEqual(first.ciphertext,second.ciphertext);
});

test('wrong passwords and modified ciphertext are rejected without returning partial plaintext',async()=>{
  const encrypted=await backup.encrypt('private world state',passphrase,webcrypto);
  await assert.rejects(()=>backup.decrypt(encrypted,'Different passphrase 2026',webcrypto),
    /password is incorrect or the backup file has been modified/i);
  const tampered=structuredClone(encrypted);
  const last=tampered.ciphertext.at(-1);
  tampered.ciphertext=tampered.ciphertext.slice(0,-1)+(last==='A'?'B':'A');
  await assert.rejects(()=>backup.decrypt(tampered,passphrase,webcrypto),
    /password is incorrect or the backup file has been modified/i);
});

test('invalid formats, unsupported KDF parameters, malformed binary fields and weak passwords are rejected',async()=>{
  const encrypted=await backup.encrypt('private world state',passphrase,webcrypto);
  assert.equal(backup.validateEnvelope({...encrypted,version:99}).valid,false);
  assert.equal(backup.validateEnvelope({...encrypted,kdf:{...encrypted.kdf,iterations:1}}).valid,false);
  assert.equal(backup.validateEnvelope({...encrypted,iv:'invalid'}).valid,false);
  await assert.rejects(()=>backup.encrypt('state','short',webcrypto),/12–1,024 characters/);
  await assert.rejects(()=>backup.decrypt(encrypted,'short',webcrypto),/12–1,024 characters/);
});

test('portable encryption refuses empty or oversized plaintext',async()=>{
  await assert.rejects(()=>backup.encrypt('',passphrase,webcrypto),/empty or exceeds/i);
  const tooLarge='x'.repeat(backup.maximumBackupBytes+1);
  await assert.rejects(()=>backup.encrypt(tooLarge,passphrase,webcrypto),/empty or exceeds/i);
});
