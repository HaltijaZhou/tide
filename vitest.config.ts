import { configDefaults, defineConfig } from 'vitest/config'

// 独立于 vite.config.ts：vitest 读取本文件后不再加载 vite.config.ts，
// 测试环境因此不加载 vite-plugin-static-copy（测试不需要拷贝 vditor 资源）。
export default defineConfig({
  test: {
    // 技能包含 node:test 脚本，不属于应用的 Vitest 测试。
    exclude: [...configDefaults.exclude, '**/.agents/**'],
    // Workaround(vitest 5.0.5 Windows bug): 默认的 forks/threads 池会把 worker
    // 内的 vitest 运行时以小写盘符 URL（file:///d:/...）加载，而测试文件里的
    // `import ... from 'vitest'` 解析为大写盘符 URL（file:///D:/...）。Node ESM
    // 按 URL 区分模块，同一物理文件被加载成两份实例，describe 找不到 runner，
    // 报 "Cannot read properties of undefined (reading 'config')"。
    // vmForks 在主进程内用 node:vm 运行测试，URL 大小写统一，无此问题。
    // 上游修复后可移除本选项。
    pool: 'vmForks',
  },
})
