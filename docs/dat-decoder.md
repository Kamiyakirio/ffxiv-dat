# DAT 解码器

主进程入口：`src/main/services/dat/decoder.ts`。

```ts
const result = decodeDat(bytes, filename);
```

输入原始 `Buffer` 和文件名，返回：

- `header`：类型、版本、有效长度等文件头信息。
- `payload`：解除已知 XOR 后的有效字节。
- `result`：解析状态、结构化数据和警告；失败原因在 `data.parseError`。
- `members`：备份文件中的内嵌配置及其偏移。
- `sha256`、`checks`：源字节摘要和可执行的身份核对。

支持角色配置 DAT、共享宏、外观预设、配置复制记录及配置备份。
解析器只处理传入的字节，不读写磁盘；64 位 ID 使用字符串保留精度。

`decoded` 表示已实现的记录布局解析完成；`partial` 表示仍有未知字段或候选解释；`unsupported` 表示没有适用的解析器。游戏数值 ID 不一定已转换成名称。PVPSET 的选择项名称、GRPSTAMP 的记录内部数值及部分社交、过滤状态仍未完全解释，输出保留原始值和偏移。

字段参考本地 FFXIVClientStructs `b72bc1f73`，磁盘边界用实际样本核对；测试使用合成数据。

针对指定中国客户端 EXE 和同目录 SqPack 的静态取证已补充市场收藏 100 槽、非空失传技能
预设、四组跨服通讯贝、五组贴纸配置、PvP 职业选择、物品菜单位图和眼镜样式列表。
解析所需的职业和眼镜样式映射保存在 `src/main/services/dat/native-save-data.json`。
PvP 选择项名称、物品菜单编号文字、通讯贝的后续存储、贴纸内部数值及若干旗标仍未完全解释；
眼镜列表的“未查看”用途来自静态调用行为推导。`partial` 项没有因结构补全而全部改成 `decoded`。
