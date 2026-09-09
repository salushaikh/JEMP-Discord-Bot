export function jempId(number: number): string {
  return `JEMP#${String(number).padStart(4, '0')}`;
}

export function brainstormId(number: number): string {
  return `B#${String(number).padStart(3, '0')}`;
}

export function projectId(number: number): string {
  return `P#${String(number).padStart(3, '0')}`;
}

export function opportunityId(number: number): string {
  return `HC#${String(number).padStart(3, '0')}`;
}

export function paymentId(number: number): string {
  return `PAY#${String(number).padStart(3, '0')}`;
}

export function applicationId(number: number): string {
  return `APP#${String(number).padStart(4, '0')}`;
}
