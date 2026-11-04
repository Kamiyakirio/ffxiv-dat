export const segmentNames: Record<string, string> = {
  LETTER: '邮件记录',
  RETTASK: '雇员任务',
  FLAGS: '界面旗标',
  RCFAV: '制作收藏',
  UIDATA: '社交数据',
  TLPH: '传送历史',
  ITCC: '物品菜单',
  PVPSET: 'PvP 设置',
  EMTH: '表情历史',
  MNONLST: '宠物收藏',
  MUNTLST: '坐骑收藏',
  EMJ: '多玛方城战',
  AOZNOTE: '青魔法预设',
  CWLS: '跨服通讯贝',
  ARCHVLST: '成就关注',
  GRPPOS: '集体动作设置',
  CRAFT: '制作记录',
  FMARKER: '场地标点',
  MYCNOT: '战果笔记',
  ORNMLST: '时尚配饰',
  MYCITEM: '失传技能',
  GRPSTAMP: '集体动作贴纸',
  RTNR: '雇员备注',
  BANNER: '肖像',
  ADVNOTE: '探索笔记',
  TOFU: '战术板',
  FISHING: '捕鱼记录',
  ACTION: '技能记录',
  TFILTER: '屏蔽词',
  READYC: '倒计时',
  PTRLST: '小队职业排序',
  CATSBM: '市场收藏',
  DESCRI: '说明已读记录',
  MJICWSP: '海岛预设',
  PERFORM: '乐器演奏',
  QPNL: '快捷面板',
  GLASSES: '眼镜',
};

export function keyActionLabel(command: string): string {
  const names: Record<string, string> = {
    OK: '确认',
    CANCEL: '取消',
    ESC: '关闭窗口',
    MENU: '打开菜单',
    MENU_OPTION: '菜单选项',
    MENU_SCALE: '调整窗口大小',
    LEFT: '向左',
    RIGHT: '向右',
    UP: '向上',
    DOWN: '向下',
    PAGEUP: '上一页',
    PAGEDOWN: '下一页',
    TOP: '跳到开头',
    BOTTOM: '跳到末尾',
    DELETE: '删除',
    HIDE: '隐藏界面',
    COPY: '复制',
    JUMP: '跳跃',
    MOVE_FORWARD: '前进',
    MOVE_BACK: '后退',
    STRAFE_LEFT: '向左平移',
    STRAFE_RIGHT: '向右平移',
    AUTO_RUN: '自动奔跑',
    HIDE_GUI: '隐藏界面',
    HOTBAR_UP: '切换上一热键栏',
    HOTBAR_DOWN: '切换下一热键栏',
  };
  const value = command.toUpperCase();
  const slot = /^HOTBAR_(\d+)_([0-9AB])$/.exec(value);
  if (slot)
    return `热键栏 ${slot[1]} · 槽位 ${slot[2] === 'A' ? 11 : slot[2] === 'B' ? 12 : slot[2] === '0' ? 10 : slot[2]}`;
  const bar = /^HOTBAR_SET_(\d+)$/.exec(value);
  return bar ? `切换至热键栏 ${bar[1]}` : (names[value] ?? command);
}

export function settingLabel(name: string): string {
  const names: Record<string, string> = {
    BattleEffectSelf: '自身战斗特效',
    BattleEffectParty: '小队成员战斗特效',
    BattleEffectOther: '其他玩家战斗特效',
    BattleEffectPvPEnemyPc: 'PvP 敌方玩家战斗特效',
    MoveMode: '移动操作方式',
    MouseSensitivity: '鼠标灵敏度',
    IsAutoFaceTarget: '自动面向目标',
    Language: '语言',
    SoundMaster: '主音量',
    SoundBgm: '背景音乐音量',
    SoundSe: '音效音量',
    SoundVoice: '语音音量',
    SoundEnv: '环境音量',
    ScreenMode: '屏幕模式',
    ScreenWidth: '屏幕宽度',
    ScreenHeight: '屏幕高度',
  };
  return names[name] ?? name;
}
