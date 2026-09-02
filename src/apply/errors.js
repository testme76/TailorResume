export class NeedsAttentionError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'NeedsAttentionError';
    this.details = details;
  }
}

export class SkipApplicationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SkipApplicationError';
    this.details = details;
  }
}

