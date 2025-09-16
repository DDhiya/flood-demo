import type { Config } from "@react-router/dev/config";
import type { RouteObject } from "react-router";

export default {
  // Config options...
  // Server-side render by default, to enable SPA mode set this to `false`
  ssr: true,
} satisfies Config;

export const routes: RouteObject[] = [
  // ...existing routes
  {
    path: "/river-ov",
    lazy: async () => {
      const m = await import("./app/routes/river-ov");
      return { Component: m.default };
    },
  },
  {
    path: "/sky-ov",
    lazy: async () => {
      const m = await import("./app/routes/sky-ov");
      return { Component: m.default };
    },
  },
];