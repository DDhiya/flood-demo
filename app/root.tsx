import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  Link,
} from "react-router";
import "./app.css";

export default function Root() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        {/* ⬇️ This injects your built CSS */}
        <Links />
      </head>
      <body>
        {/* Your top bar / nav */}
        <header className="header">
          <strong>Flood Prediction System</strong>
          <div className="spacer" />
          {/* <Link className="btn" to="/control">Control</Link>
          <Link className="btn" to="/control-lite">Control (Lite)</Link>
          <Link className="btn" to="/sky">Sky</Link>
          <Link className="btn" to="/river">River</Link> */}
        </header>

        <main className="main">
          <Outlet />
        </main>

        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
