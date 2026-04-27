// ── permissions.js ────────────────────────────────────────────
// 权限判断纯函数。依赖：无外部依赖（仅接收 user/task 对象作为参数）。

function hasPermission(user, code) {
  if (!user) return false
  const perms = user.permissions || []
  return perms.includes('*') || perms.includes(code)
}

// 判断 task 是否归属当前 user。三层匹配，越严格越优先：
//  1) task.owner_username === user.username（最准，未来加字段后用）
//  2) task.owner === user.display_name（精确字符串匹配）
//  3) task.owner 包含 user.display_name 去括号前缀（兼容老数据，"晓东（店长）" 用户能命中 "晓东（运营）" 任务）
function isTaskOwner(user, task) {
  if (!user || !task) return false
  if (task.owner_username && user.username && task.owner_username === user.username) return true
  if (task.owner && user.display_name && task.owner === user.display_name) return true
  // 兜底：把 display_name 拆出主名（去掉"（XX）"），看 owner 字符串是否包含
  if (task.owner && user.display_name) {
    const namePrefix = user.display_name.split(/[（(]/)[0].trim()
    // 至少 2 个字符才算（防止"刘"匹配到所有姓刘的）
    if (namePrefix.length >= 2 && task.owner.includes(namePrefix)) return true
  }
  return false
}

function canEditOwnTask(user, task) {
  if (!user || !task) return false
  if (hasPermission(user, 'task.edit_all')) return true
  return hasPermission(user, 'task.edit_own') && isTaskOwner(user, task)
}

function canViewTask(user, task) {
  if (!user) return false
  if (hasPermission(user, 'task.view_all')) return true
  return hasPermission(user, 'task.view_own') && isTaskOwner(user, task)
}


