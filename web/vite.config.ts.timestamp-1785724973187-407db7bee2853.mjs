// vite.config.ts
import { defineConfig } from "file:///Users/michaelzhang/WorkBuddy/2026-08-02-12-07-39/dusk-v3/web/node_modules/vite/dist/node/index.js";
import react from "file:///Users/michaelzhang/WorkBuddy/2026-08-02-12-07-39/dusk-v3/web/node_modules/@vitejs/plugin-react/dist/index.js";
import { viteSingleFile } from "file:///Users/michaelzhang/WorkBuddy/2026-08-02-12-07-39/dusk-v3/web/node_modules/vite-plugin-singlefile/dist/esm/index.js";
import path from "path";
var __vite_injected_original_dirname = "/Users/michaelzhang/WorkBuddy/2026-08-02-12-07-39/dusk-v3/web";
var vite_config_default = defineConfig({
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: {
      "@": path.resolve(__vite_injected_original_dirname, "src"),
      "@engine": path.resolve(__vite_injected_original_dirname, "../engine"),
      "@store": path.resolve(__vite_injected_original_dirname, "../store")
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: "dist",
    assetsInlineLimit: 1e8
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMvbWljaGFlbHpoYW5nL1dvcmtCdWRkeS8yMDI2LTA4LTAyLTEyLTA3LTM5L2R1c2stdjMvd2ViXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvVXNlcnMvbWljaGFlbHpoYW5nL1dvcmtCdWRkeS8yMDI2LTA4LTAyLTEyLTA3LTM5L2R1c2stdjMvd2ViL3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9Vc2Vycy9taWNoYWVsemhhbmcvV29ya0J1ZGR5LzIwMjYtMDgtMDItMTItMDctMzkvZHVzay12My93ZWIvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tIFwidml0ZVwiO1xuaW1wb3J0IHJlYWN0IGZyb20gXCJAdml0ZWpzL3BsdWdpbi1yZWFjdFwiO1xuaW1wb3J0IHsgdml0ZVNpbmdsZUZpbGUgfSBmcm9tIFwidml0ZS1wbHVnaW4tc2luZ2xlZmlsZVwiO1xuaW1wb3J0IHBhdGggZnJvbSBcInBhdGhcIjtcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcGx1Z2luczogW3JlYWN0KCksIHZpdGVTaW5nbGVGaWxlKCldLFxuICByZXNvbHZlOiB7XG4gICAgYWxpYXM6IHtcbiAgICAgIFwiQFwiOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcInNyY1wiKSxcbiAgICAgIFwiQGVuZ2luZVwiOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcIi4uL2VuZ2luZVwiKSxcbiAgICAgIFwiQHN0b3JlXCI6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi4vc3RvcmVcIiksXG4gICAgfSxcbiAgfSxcbiAgc2VydmVyOiB7XG4gICAgcG9ydDogNTE3MyxcbiAgICBwcm94eToge1xuICAgICAgXCIvYXBpXCI6IHtcbiAgICAgICAgdGFyZ2V0OiBcImh0dHA6Ly9sb2NhbGhvc3Q6MzAwMVwiLFxuICAgICAgICBjaGFuZ2VPcmlnaW46IHRydWUsXG4gICAgICB9LFxuICAgIH0sXG4gIH0sXG4gIGJ1aWxkOiB7XG4gICAgb3V0RGlyOiBcImRpc3RcIixcbiAgICBhc3NldHNJbmxpbmVMaW1pdDogMTAwMDAwMDAwLFxuICB9LFxufSk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQXlXLFNBQVMsb0JBQW9CO0FBQ3RZLE9BQU8sV0FBVztBQUNsQixTQUFTLHNCQUFzQjtBQUMvQixPQUFPLFVBQVU7QUFIakIsSUFBTSxtQ0FBbUM7QUFLekMsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUyxDQUFDLE1BQU0sR0FBRyxlQUFlLENBQUM7QUFBQSxFQUNuQyxTQUFTO0FBQUEsSUFDUCxPQUFPO0FBQUEsTUFDTCxLQUFLLEtBQUssUUFBUSxrQ0FBVyxLQUFLO0FBQUEsTUFDbEMsV0FBVyxLQUFLLFFBQVEsa0NBQVcsV0FBVztBQUFBLE1BQzlDLFVBQVUsS0FBSyxRQUFRLGtDQUFXLFVBQVU7QUFBQSxJQUM5QztBQUFBLEVBQ0Y7QUFBQSxFQUNBLFFBQVE7QUFBQSxJQUNOLE1BQU07QUFBQSxJQUNOLE9BQU87QUFBQSxNQUNMLFFBQVE7QUFBQSxRQUNOLFFBQVE7QUFBQSxRQUNSLGNBQWM7QUFBQSxNQUNoQjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQUEsRUFDQSxPQUFPO0FBQUEsSUFDTCxRQUFRO0FBQUEsSUFDUixtQkFBbUI7QUFBQSxFQUNyQjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
