interface PayloadAccessRequest {
  user?: unknown | null
}

interface PayloadAccessArgs {
  req: PayloadAccessRequest
}

export function isAuthenticatedPayloadRequest(
  args: PayloadAccessArgs,
): boolean {
  return Boolean(args.req.user)
}

export function denyPayloadOperation(): false {
  return false
}
