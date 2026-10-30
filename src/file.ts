export interface OpenedFile { name: string; content: string; size: number }

/** 文件系统适配器：生产环境注入 Tauri invoke，测试注入 fake */
export interface FsAdapter {
  open(path: string): Promise<OpenedFile>
  save(path: string, content: string, expected: string | null, expectedMissing: boolean): Promise<void>
}

export type SessionStatus = 'empty' | 'clean' | 'dirty' | 'saving' | 'error'

export interface SessionState {
  path: string | null
  name: string
  status: SessionStatus
}

export function createSession(fs: FsAdapter, onChange?: (s: SessionState) => void) {
  let path: string | null = null
  let name = '未命名'
  let content = ''
  let savedContent = ''
  let status: SessionStatus = 'empty'
  let saving = false
  let pendingSave: Promise<void> | null = null
  let hasSavedFile = false
  let saveError: unknown = null

  const notify = () => onChange?.(getState())
  const getState = (): SessionState => ({ path, name, status })

  return {
    getState,
    getContent: () => content,
    getSavedContent: () => savedContent,
    getSaveError: () => saveError,
    async waitForSave() {
      while (pendingSave) await pendingSave
    },
    isDirty: () => status === 'dirty' || status === 'saving' || status === 'error',
    setPathForNewFile(p: string) {
      path = p
      name = p.split(/[\\/]/).pop() || '未命名'
      hasSavedFile = false
      status = 'dirty' // 空文档也需要真正创建文件
      notify()
    },
    async open(p: string, canReplace?: () => boolean) {
      const previousPath = path
      const previousContent = content
      const r = await fs.open(p)
      if (path !== previousPath || content !== previousContent || saving || canReplace && !canReplace()) {
        throw 'UNSAVED_CHANGES'
      }
      path = p; name = r.name; content = r.content; savedContent = r.content; status = 'clean'
      hasSavedFile = true
      saveError = null
      notify()
      return r
    },
    edit(value: string) {
      content = value
      if (!saving) {
        status = value === savedContent ? 'clean' : 'dirty'
        saveError = null
      }
      notify()
    },
    async save(force = false, expectMissing = false) {
      while (pendingSave) await pendingSave
      if (!path || !force && content === savedContent && status === 'clean') return
      const savingPath = path
      const savingContent = content
      const expectedMissing = expectMissing || !hasSavedFile && !force
      const expected = force || expectedMissing ? null : savedContent
      saving = true; status = 'saving'; notify()
      const operation = (async () => {
        try {
          await fs.save(savingPath, savingContent, expected, expectedMissing)
          savedContent = savingContent
          hasSavedFile = true
          saveError = null
          status = content === savedContent ? 'clean' : 'dirty'
        } catch (error) {
          saveError = error
          status = 'error'
        } finally {
          saving = false
          notify()
        }
      })()
      pendingSave = operation
      try { await operation } finally { pendingSave = null }
    },
    reload(newContent: string) {
      content = newContent; savedContent = newContent; status = 'clean'
      hasSavedFile = true; saveError = null
      notify()
    },
  }
}

export type FileSession = ReturnType<typeof createSession>
