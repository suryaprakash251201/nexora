import { createBrowserRouter, createHashRouter, useParams } from "react-router-dom";
import App from "./App";
import SharePage from "./components/SharePage";

function SharePageRoute() {
  const { token } = useParams<{ token: string }>();
  return token ? <SharePage token={token} /> : null;
}

const routes = [
  {
    path: "/s/:token",
    element: <SharePageRoute />,
  },
  {
    path: "/*",
    element: <App />,
  }
];

// If running in Tauri Desktop, use HashRouter. Otherwise, use BrowserRouter for Web.
const isTauri = "__TAURI_INTERNALS__" in window;
export const router = isTauri ? createHashRouter(routes) : createBrowserRouter(routes);
