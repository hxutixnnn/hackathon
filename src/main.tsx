import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { AnimatePresence } from "framer-motion";
import Home from "./pages/Home";
import Scan from "./pages/Scan";
import "./index.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

// Component for route animations
function AnimatedRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<Home />} />
        <Route path="/scan/:id" element={<Scan />} />
      </Routes>
    </AnimatePresence>
  );
}

function Root() {
  return (
    <React.StrictMode>
      <ConvexProvider client={convex}>
        <BrowserRouter>
          <AnimatedRoutes />
        </BrowserRouter>
      </ConvexProvider>
    </React.StrictMode>
  );
}

export { Root, AnimatedRoutes };

ReactDOM.createRoot(document.getElementById("root")!).render(<Root />);
