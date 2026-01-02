import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // ★設定為 Repository 名稱的絕對路徑 (前後都要有斜線)
  base: '/noritake-ai-sketch/', 
})