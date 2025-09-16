import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/control-index.tsx"),         // "/" uses the wrapper
  route("control", "routes/control.tsx"),    // "/control" uses the real file
  route("control-lite", "routes/control-lite.tsx"),   // ⬅️ new
  route("sky", "routes/sky.tsx"),
  route("river", "routes/river.tsx"),
  route("sky-ov", "routes/sky-ov.tsx"),
  route("river-ov", "routes/river-ov.tsx"),
  route("brochure", "routes/brochure.tsx"),

  // keep scaffold samples (optional)
  route("home", "routes/home.tsx"),
] satisfies RouteConfig;
