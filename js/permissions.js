// ── permissions.js ────────────────────────────────────────────
// 权限判断纯函数。依赖：无外部依赖（仅接收 user/task 对象作为参数）。

function hasPermission(user, code) {
  if (!user) return false
  const perms = user.permissions || []
  return perms.includes('*') || perms.includes(code)
}
function canEditOwnTask(user, task) {
  if (!user || !task) return false
  if (hasPermission(user, 'task.edit_all')) return true
  return hasPermission(user, 'task.edit_own') && task.owner && task.owner.includes(user.display_name.split('（')[0])
}


