# Windows 便携版发布

工作流位于 `.github/workflows/github_ci.yml`。构建使用 GitHub 托管的
`windows-latest` runner，目标为 Windows x64，无需自行安装或注册 runner。

发布文件为 `dat-win32-x64-<version>.zip`。下载后完整解压，运行其中的
`dat.exe`，无需安装；运行时需要保留同目录的 DLL、resources 等文件。

## 自动构建

推送到 `master`、提交 PR 或在 Actions 页面手动运行工作流时，会先执行
lint、类型检查和测试，再构建 Windows 便携 ZIP。压缩包可在该次工作流的
Artifacts 中下载，保留 14 天。

## 发布到 GitHub Releases

1. 更新 `package.json` 和 `package-lock.json` 中的版本号，例如运行
   `npm version 1.0.1 --no-git-tag-version`。
2. 提交并推送版本改动和工作流。
3. 创建与应用版本一致的标签，并推送到 GitHub：

   ```sh
   git tag v1.0.1
   git push origin v1.0.1
   ```

推送 `v*` 标签会触发检查和 Windows 构建，成功后创建同名 GitHub Release，
自动生成发布说明并上传便携 ZIP。手动运行工作流时选择已有 `v*` 标签也可
触发发布；选择分支时仅构建。相同标签的 Release 已存在时，发布步骤会失败。

发布使用工作流自带的 `GITHUB_TOKEN`，无需配置个人 Token。只有发布任务授予
`contents: write` 权限。

## 在 Windows 本机构建

使用 Node.js 24：

```sh
npm ci
npm run make:windows
```

产物位于 `out/make/zip/win32/x64/`。
