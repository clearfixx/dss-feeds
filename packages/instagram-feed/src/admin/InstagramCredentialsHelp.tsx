import type { ReactNode } from 'react'

export function InstagramCredentialsHelp(): ReactNode {
  return (
    <div className="dss-instagram-feed-admin__credentials">
      <strong>Credentials stay in server environment variables.</strong>
      <p>Official: DSS_INSTAGRAM_ACCESS_TOKEN and DSS_INSTAGRAM_USER_ID.</p>
      <p>Experimental GraphQL: DSS_INSTAGRAM_SESSION_ID and DSS_INSTAGRAM_CSRF_TOKEN. DSS_INSTAGRAM_DS_USER_ID, DSS_INSTAGRAM_APP_ID, DSS_INSTAGRAM_USER_AGENT, and DSS_INSTAGRAM_GRAPHQL_DOC_ID are optional overrides.</p>
    </div>
  )
}
