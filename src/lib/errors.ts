export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'DOMAIN_ERROR',
    public readonly expose = true
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const GENERIC_VERIFICATION_FAILURE = "We couldn't verify that email for this server. Make sure you're using the same email address submitted with your Jobless Empire application. If you believe this is an error, contact an administrator.";
