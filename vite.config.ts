import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { config as loadEnvFile } from "dotenv";
import { defineConfig } from "vite";

loadEnvFile({ path: [".env.local", ".env"], quiet: true });

export default defineConfig({
	resolve: { tsconfigPaths: true },
	plugins: [tailwindcss(), tanstackStart(), viteReact()],
});
