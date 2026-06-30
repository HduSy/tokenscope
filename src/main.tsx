import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

const style = document.createElement("style");
style.textContent = `
  html, body, #root { margin: 0; padding: 0; height: 100%; background: transparent; }
  * { box-sizing: border-box; }
  .om-scroll { scrollbar-width: none; -ms-overflow-style: none; }
  .om-scroll::-webkit-scrollbar { width: 0; height: 0; display: none; }
  /* During a theme flip we add this class for a couple of frames so the whole
     panel repaints in the new theme in one step. Without it, every element's
     CSS transition (e.g. the Segmented selected pill's "background .15s")
     cross-fades the old color into the new one — most visible as the white
     selected pill fading on a background light→dark switch made while hidden. */
  .ts-no-transition, .ts-no-transition * { transition: none !important; }
`;
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
