import type { MetadataRoute } from "next";

import { siteConfig } from "@/config/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: siteConfig.name,
    short_name: siteConfig.name,
    description: siteConfig.description,
    start_url: "/app",
    scope: "/",
    id: "/app",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#ffffff",
    theme_color: "#1d658e",
    categories: ["business", "productivity"],
    lang: "pt-BR",
    dir: "ltr",
    icons: [],
  };
}
