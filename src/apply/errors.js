export class NeedsAttentionError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'NeedsAttentionError';
    this.details = details;
  }
}

