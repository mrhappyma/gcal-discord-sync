//modified @google-cloud/local-auth

import { OAuth2Client } from "google-auth-library";
import * as http from "http";
import { URL } from "url";
import open from "open";
import arrify from "arrify";
import destroyer from "server-destroy";
import { AddressInfo } from "net";

const invalidRedirectUri = `The provided keyfile does not define a valid
redirect URI. There must be at least one redirect URI defined, and this sample
assumes it redirects to 'http://localhost:3000/oauth2callback'.  Please edit
your keyfile, and add a 'redirect_uris' section.  For example:

"redirect_uris": [
  "http://localhost:3000/oauth2callback"
]
`;

function isAddressInfo(addr: string | AddressInfo | null): addr is AddressInfo {
  return (addr as AddressInfo).port !== undefined;
}

export interface LocalAuthOptions {
  clientId: string;
  clientSecret: string;
  projectId: string;
  scopes: string[] | string;
}

// Open an http server to accept the oauth callback. In this
// simple example, the only request to our webserver is to
// /oauth2callback?code=<code>
export async function authenticate(
  options: LocalAuthOptions
): Promise<OAuth2Client> {
  const keys = {
    client_id: options.clientId,
    project_id: options.clientSecret,
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
    client_secret: options.clientSecret,
    redirect_uris: ["http://localhost"],
  };
  if (!keys.redirect_uris || keys.redirect_uris.length === 0) {
    throw new Error(invalidRedirectUri);
  }
  const redirectUri = new URL(keys.redirect_uris[0] ?? "http://localhost");
  if (redirectUri.hostname !== "localhost") {
    throw new Error(invalidRedirectUri);
  }

  // create an oAuth client to authorize the API call
  const client = new OAuth2Client({
    clientId: keys.client_id,
    clientSecret: keys.client_secret,
  });

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url!, "http://localhost:3000");
        if (url.pathname !== redirectUri.pathname) {
          res.end("Invalid callback URL");
          return;
        }
        const searchParams = url.searchParams;
        if (searchParams.has("error")) {
          res.end("Authorization rejected.");
          reject(new Error(searchParams.get("error")!));
          return;
        }
        if (!searchParams.has("code")) {
          res.end("No authentication code provided.");
          reject(new Error("Cannot read authentication code."));
          return;
        }

        const code = searchParams.get("code");
        const { tokens } = await client.getToken({
          code: code!,
          redirect_uri: redirectUri.toString(),
        });
        client.credentials = tokens;
        resolve(client);
        res.end("Authentication successful! Please return to the console.");
      } catch (e) {
        reject(e);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (server as any).destroy();
      }
    });

    const listenPort = 0;

    server.listen(listenPort, () => {
      const address = server.address();
      if (isAddressInfo(address)) {
        redirectUri.port = String(address.port);
      }
      const scopes = arrify(options.scopes || []);
      // open the browser to the authorize url to start the workflow
      const authorizeUrl = client.generateAuthUrl({
        redirect_uri: redirectUri.toString(),
        access_type: "offline",
        scope: scopes.join(" "),
      });
      console.log(authorizeUrl);
      open(authorizeUrl, { wait: false }).then((cp) => cp.unref());
    });
    destroyer(server);
  });
}
