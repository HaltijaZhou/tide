import { describe, it, expect, vi } from 'vitest'
import { createSession } from './file'

function fakeFs() {
  return {
    open: vi.fn(async (_path: string) => ({ name: 'a.md', content: '# 旧', size: 4 })),
    save: vi.fn(async (_path: string, _content: string) => {}),
  }
}

describe('file session 状态机', () => {
  it('open 后为 clean，可读取内容', async () => {
    const s = createSession(fakeFs())
    await s.open('C:/x/a.md')
    expect(s.getState()).toMatchObject({ path: 'C:/x/a.md', name: 'a.md', status: 'clean' })
    expect(s.getContent()).toBe('# 旧')
  })

  it('edit 后变 dirty；改回已保存内容则回到 clean', async () => {
    const s = createSession(fakeFs())
    await s.open('C:/x/a.md')
    s.edit('# 新')
    expect(s.getState().status).toBe('dirty')
    s.edit('# 旧')
    expect(s.getState().status).toBe('clean')
  })

  it('save 成功后回到 clean，写入的是当前内容', async () => {
    const fs = fakeFs()
    const s = createSession(fs)
    await s.open('C:/x/a.md')
    s.edit('# 新')
    await s.save()
    expect(s.getState().status).toBe('clean')
    expect(fs.save).toHaveBeenCalledWith('C:/x/a.md', '# 新', '# 旧', false)
  })

  it('save 失败进入 error 状态，内容保留', async () => {
    const fs = fakeFs()
    fs.save.mockRejectedValueOnce(new Error('disk full'))
    const s = createSession(fs)
    await s.open('C:/x/a.md')
    s.edit('# 新')
    await s.save()
    expect(s.getState().status).toBe('error')
    expect(s.getContent()).toBe('# 新')
  })

  it('保存进行中继续编辑时，未写入的内容仍标记为未保存', async () => {
    let finishSave!: () => void
    let disk = '# 旧'
    const fs = {
      open: async () => ({ name: 'a.md', content: disk, size: disk.length }),
      save: async (_path: string, value: string) => {
        await new Promise<void>((resolve) => { finishSave = resolve })
        disk = value
      },
    }
    const s = createSession(fs)
    await s.open('C:/x/a.md')
    s.edit('# 第一版')
    const saving = s.save()
    s.edit('# 第二版')
    finishSave()
    await saving

    expect(disk).toBe('# 第一版')
    expect(s.getContent()).toBe('# 第二版')
    expect(s.getState().status).toBe('dirty')
    expect(s.isDirty()).toBe(true)
  })

  it('保存尚未完成时仍视为有未保存内容', async () => {
    let finishSave!: () => void
    const fs = {
      ...fakeFs(),
      save: async () => new Promise<void>((resolve) => { finishSave = resolve }),
    }
    const s = createSession(fs)
    await s.open('C:/x/a.md')
    s.edit('# 新')
    const saving = s.save()
    expect(s.isDirty()).toBe(true)
    finishSave()
    await saving
    expect(s.isDirty()).toBe(false)
  })

  it('保存期间再次请求保存会等待前一次写入并保存最新内容', async () => {
    let finishFirst!: () => void
    let disk = '# 旧'
    let writes = 0
    const fs = {
      open: async () => ({ name: 'a.md', content: disk, size: disk.length }),
      save: async (_path: string, value: string) => {
        writes += 1
        if (writes === 1) await new Promise<void>((resolve) => { finishFirst = resolve })
        disk = value
      },
    }
    const s = createSession(fs)
    await s.open('C:/x/a.md')
    s.edit('# 第一版')
    const first = s.save()
    s.edit('# 第二版')
    const second = s.save()
    finishFirst()
    await Promise.all([first, second])

    expect(disk).toBe('# 第二版')
    expect(s.getState().status).toBe('clean')
  })

  it('reload 外部内容后为 clean', async () => {
    const s = createSession(fakeFs())
    await s.open('C:/x/a.md')
    s.edit('# 我改的')
    s.reload('# 磁盘上的')
    expect(s.getState().status).toBe('clean')
    expect(s.getContent()).toBe('# 磁盘上的')
  })
})
