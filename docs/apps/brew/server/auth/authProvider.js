export class AuthProvider {
  normalizeUsername(username) {
    return typeof username === 'string' && username.trim() ? username.trim().slice(0, 32) : null;
  }

  async authenticate() {
    throw new Error('AuthProvider.authenticate not implemented');
  }

  issueSession() {
    throw new Error('AuthProvider.issueSession not implemented');
  }

  verifySession() {
    throw new Error('AuthProvider.verifySession not implemented');
  }

  issueReconnect() {
    throw new Error('AuthProvider.issueReconnect not implemented');
  }

  verifyReconnect() {
    throw new Error('AuthProvider.verifyReconnect not implemented');
  }
}
