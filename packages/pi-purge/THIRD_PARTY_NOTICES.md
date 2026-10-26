# Third-party notices

## Pi Purge code

The Pi extension implementation is Copyright (c) 2026 Jingoz and is distributed under the MIT License in `LICENSE`.

## Bundled prompt and envelope layout

The bundled `prompts/default.md` is the adapted prompt already validated in the local Pi deployment. Its upstream basis and the envelope-layout normalization come from **dsh-purge**, by **YuJunZhiXue / 小杨**:

- Original project: https://github.com/YuJunZhiXue/dsh-purge
- Archival mirror: https://github.com/mmparko/dsh-purge
- Source checkout examined: `033e6bd1e0f101352b39075ecd0d758ffef26b76`
- Bundled prompt SHA256: `4487c0b46067a795c6b1210a596b8580e832abaf889558897f1ff51ffb994ea6`

This adapted text is not a verbatim copy of the source checkout's factory default. It contains no runtime reference to the source checkout or another application's files. The entire prompt ships with this package; installation and execution do not fetch it from another project.

The upstream MIT text (Copyright (c) 2026 小杨) is preserved in `third-party/dsh-purge-LICENSE`. The mirror's attribution and distribution notice is preserved in full in `third-party/dsh-purge-MIRROR-NOTICE.md`.

The upstream README additionally requires attribution and describes the project as free and non-profit, forbidding paid sales/resales of courses, plugins or tokens. These source notices are retained here; the package does not represent the upstream prompt as original Pi Purge work or advertise unrestricted commercial reuse.
