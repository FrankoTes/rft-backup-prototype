export const TransportErrorCodes = Object.freeze({
  SERVER_UNREACHABLE: 'server_unreachable',
  TIMEOUT: 'timeout',
  AUTHENTICATION_REFUSED: 'authentication_refused',
  PERMISSION_DENIED: 'permission_denied',
  REMOTE_DIRECTORY_UNAVAILABLE: 'remote_directory_unavailable',
  TRANSFER_INTERRUPTED: 'transfer_interrupted',
  INSUFFICIENT_SPACE: 'insufficient_space',
  INVALID_CONFIGURATION: 'invalid_configuration',
  VALIDATION_FAILED: 'validation_failed',
});

export class TransportError extends Error {
  constructor(code, message, options = {}) {
    super(redactSecret(message, options.secret));
    this.name = 'TransportError';
    this.code = code;
    this.cause = options.cause;
  }
}

export function redactSecret(value, secret) {
  let text = String(value ?? '');
  if (secret) text = text.split(String(secret)).join('[REDACTED]');
  return text.replace(/(password\s*[=:]\s*)\S+/gi, '$1[REDACTED]');
}

export function classifyTransportFailure(error, secret) {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = redactSecret(rawMessage, secret);
  const lower = message.toLowerCase();
  const code = error?.code ? String(error.code).toLowerCase() : '';

  if (error instanceof TransportError) return error;
  if (lower.includes('timed out') || lower.includes('timeout') || lower.includes('etimedout') || code === 'etimedout') return new TransportError(TransportErrorCodes.TIMEOUT, 'Délai de connexion ou de transfert SFTP dépassé.', { cause: error, secret });
  if (lower.includes('auth') || lower.includes('all configured authentication methods failed') || lower.includes('permission denied (publickey,password)')) return new TransportError(TransportErrorCodes.AUTHENTICATION_REFUSED, 'Authentification SFTP refusée.', { cause: error, secret });
  if (lower.includes('permission denied') || lower.includes('eacces')) return new TransportError(TransportErrorCodes.PERMISSION_DENIED, 'Permissions insuffisantes sur la destination SFTP.', { cause: error, secret });
  if (lower.includes('no such file') || lower.includes('not a directory') || lower.includes('failure') && lower.includes('mkdir')) return new TransportError(TransportErrorCodes.REMOTE_DIRECTORY_UNAVAILABLE, 'Répertoire distant SFTP inaccessible.', { cause: error, secret });
  if (lower.includes('no space') || lower.includes('quota') || lower.includes('disk full') || code === 'enospc') return new TransportError(TransportErrorCodes.INSUFFICIENT_SPACE, 'Espace distant insuffisant pour recevoir la sauvegarde.', { cause: error, secret });
  if (lower.includes('econnrefused') || lower.includes('econnreset') || lower.includes('enotfound') || lower.includes('ehostunreach') || lower.includes('network') || code.startsWith('econn')) return new TransportError(TransportErrorCodes.SERVER_UNREACHABLE, 'Serveur SFTP inaccessible.', { cause: error, secret });
  return new TransportError(TransportErrorCodes.TRANSFER_INTERRUPTED, 'Transfert SFTP interrompu avant la fin.', { cause: error, secret });
}
