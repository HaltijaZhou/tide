import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'

it('首屏脚本在应用加载前根据保存值设置有效主题，存储异常时跟随系统', () => {
  const html = readFileSync('index.html', 'utf8')
  const script = html.match(/<script id="theme-bootstrap">([\s\S]*?)<\/script>/)?.[1]
  expect(script).toBeDefined()
  expect(html.indexOf('id="theme-bootstrap"')).toBeLessThan(html.indexOf('src="/src/main.ts"'))
  for (const [stored, systemDark, expected] of [['light', true, 'light'], ['dark', false, 'dark'], [null, true, 'dark']]) {
    const root = { dataset: {} }
    runInNewContext(script, {
      document: { documentElement: root },
      window: { matchMedia: () => ({ matches: systemDark }) },
      localStorage: { getItem: () => stored },
    })
    expect(root.dataset.theme).toBe(expected)
  }
  const root = { dataset: {} }
  runInNewContext(script, {
    document: { documentElement: root },
    window: { matchMedia: () => ({ matches: true }) },
    localStorage: { getItem: () => { throw new Error('unavailable') } },
  })
  expect(root.dataset.theme).toBe('dark')
})
