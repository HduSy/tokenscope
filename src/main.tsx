import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

const style = document.createElement("style");
style.textContent = `
  html, body, #root { margin: 0; padding: 0; height: 100%; background: #1f2226; }
  * { box-sizing: border-box; }
  .om-scroll { scrollbar-width: none; -ms-overflow-style: none; }
  .om-scroll::-webkit-scrollbar { width: 0; height: 0; display: none; }
`;
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
