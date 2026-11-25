# Website Thanks Mailroom

A standalone email operations console for Website Thanks, powered by Resend. Review recent delivery activity, find messages and submit the original content as a new email after a deliberate confirmation.

## Run locally

1. Install Node.js 20.9 or later.
2. Run `npm install` and `npm run dev`.
3. Open `http://localhost:3000`.
4. To connect a Resend account, copy `.env.example` to `.env.local`, add a server side `RESEND_API_KEY`, and set `RESEND_FROM` to a sender identity verified in Resend.

Without credentials, the console runs in demo mode and no real messages are sent. Keep credentials server side. Do not use a `NEXT_PUBLIC_` prefix for the Resend API key.

## Current scope

The dashboard fetches email activity from Resend and supports submitting the original message content as a new email after an explicit browser confirmation. The API key remains on the server. Authentication and role management are not implemented yet, so deploy only behind Website Thanks' existing staff access layer or a trusted private network until access controls are added.


## Deployment

This is a standalone private operations tool. Before exposing it on the public internet, add Website Thanks staff authentication and authorization, then configure `RESEND_API_KEY` and `RESEND_FROM` in the hosting provider's secret store. Do not deploy it publicly without access control. A successful repeat send creates a new email record in Resend and may deliver a duplicate to the original recipients.
