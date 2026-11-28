export function publicVerificationToken(token: string) {
  return token.startsWith('emailgo-verify=')
    ? token.replace(/^emailgo-verify=/, 'send-thanks-verify=')
    : token;
}

export function verificationRecordHosts(domain: string, token: string) {
  const hosts = [`_send-thanks.${domain}`];
  if (token.startsWith('emailgo-verify=')) hosts.push(`_emailgo.${domain}`);
  return hosts;
}
