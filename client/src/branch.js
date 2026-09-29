export function getBranch() {
  const raw = localStorage.getItem('posv_branch')
  if (raw) {
    try {
      const b = JSON.parse(raw)
      if (b && b.id) return b
    } catch (e) {}
  }
  return null
}

export function setBranch(b) {
  if (b && b.id) localStorage.setItem('posv_branch', JSON.stringify({ id: b.id, name: b.name }))
  else localStorage.removeItem('posv_branch')
}

export function branchId() {
  const b = getBranch()
  return b ? b.id : null
}

export function branchName() {
  const b = getBranch()
  return b ? b.name : ''
}