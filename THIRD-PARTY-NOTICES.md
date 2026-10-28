# 제3자 의존성과 고지

이 목록은 공개본을 준비할 때 로컬에 설치되어 있던 패키지와 잠금파일을 대조한 기록입니다. 프로젝트 전체의 재사용 라이선스는 결정되지 않았습니다. 아래 라이선스는 해당 제3자 구성요소에만 적용됩니다.

공개 소스에는 `node_modules`와 생성된 vendor·클라이언트·Worker 번들을 포함하지 않습니다. 설치·빌드로 제3자 파일을 준비하며, 확보한 라이선스 원문은 `LICENSES/`에 보존합니다. 라이브러리나 실행 번들을 별도로 재배포하려면 전이 의존성과 하위 자산의 원문 고지까지 다시 확인해야 합니다.

| 패키지 | 잠금 버전 | 확인한 라이선스 | 이 공개본에 보존한 원문 |
| --- | --- | --- | --- |
| lightweight-charts | 5.2.0 | Apache-2.0 및 사용자 표시 고지 | `LICENSES/lightweight-charts/LICENSE` |
| pdfjs-dist | 6.3.289 | Apache-2.0 및 하위 자산별 조건 | `LICENSES/pdfjs-dist/` |
| web-push | 3.6.7 | MPL-2.0 | `LICENSES/web-push/LICENSE` |
| drizzle-kit | 0.31.11 | 패키지 메타데이터: MIT | 설치 패키지에 원문 LICENSE가 없어 미동봉 |
| drizzle-orm | 0.44.7 | 패키지 메타데이터: Apache-2.0 | 설치 패키지에 원문 LICENSE가 없어 미동봉 |
| esbuild | 0.25.12 | MIT | `LICENSES/esbuild/LICENSE.md` |
| eslint | 10.12.0 | MIT | `LICENSES/eslint/LICENSE` |
| typescript | 7.0.2 | Apache-2.0 | `LICENSES/typescript/LICENSE`, `NOTICE.txt` |

## TradingView Lightweight Charts

[TradingView](https://www.tradingview.com/)가 제공하는 차트 라이브러리입니다. 설치된 README에는 사용자에게 접근 가능한 화면의 제작자 고지와 TradingView 링크를 요구하는 설명이 있습니다. 공개본의 공통 하단에 라이브러리 이름·제작자·링크를 표시하고 기존 차트별 표시도 유지했습니다.

설치된 5.2.0 JavaScript 헤더의 저작권 연도는 2026입니다. 패키지에는 별도 NOTICE 원문이 없으며, 기존 `scripts/chart-assets.mjs`가 만드는 `NOTICE.txt`에는 2025 문구가 들어 있습니다. 이 생성 문구를 upstream NOTICE 원문 검증 완료로 취급하지 않습니다. 실제 번들 재배포 전에는 해당 버전의 원문 NOTICE를 추가 확인해야 합니다.

standalone 빌드에는 전이 구성요소가 포함됩니다. 로컬 메타데이터에서 `fancy-canvas` 2.1.0은 MIT로 확인했으나 원문 LICENSE는 발견되지 않았습니다. Lightweight Charts README는 포함된 tslib 일부에 BSD Zero Clause 조건이 적용된다고 설명합니다. 이번 소스 공개본에는 standalone 파일 자체를 동봉하지 않습니다.

외부 `s3.tradingview.com/tv.js` 위젯은 별도 서비스이며 Lightweight Charts와 같은 라이선스로 간주하지 않습니다. 기존 표시 문구를 유지하되 공개 미리보기의 CSP로 외부 위젯 로드를 차단합니다.

## PDF.js 하위 자산

`LICENSES/pdfjs-dist/`에는 설치 패키지의 다음 고지 원문을 그대로 보존했습니다.

- `cmaps/LICENSE`: Adobe 저작권 및 BSD 3-clause 형태의 조건
- `standard_fonts/LICENSE_FOXIT`: PDFium 저작권 및 BSD 3-clause 형태의 조건
- `standard_fonts/LICENSE_LIBERATION`: GPL v2, font embedding exception 및 추가 예외/EULA
- `wasm/LICENSE_JBIG2`, `LICENSE_PDFJS_JBIG2`: PDFium BSD 고지와 Apache-2.0 관련 원문
- `wasm/LICENSE_OPENJPEG`, `LICENSE_PDFJS_OPENJPEG`: BSD 2-clause
- `wasm/LICENSE_QCMS`, `LICENSE_PDFJS_QCMS`: MIT

빌드는 확장자가 없거나 `_`·`-` 접미사가 붙은 LICENSE/NOTICE도 생성 자산에 보존하도록 수정했습니다. `quickjs-eval.js`와 `quickjs-eval.wasm`의 별도 QuickJS 고지는 설치된 wasm 폴더에서 발견되지 않았습니다. 이 항목의 추가 원문 확인은 완료하지 않았습니다.

## 글꼴·아이콘과 데이터

기존 Pretendard 1.3.9 외부 CDN 링크를 제거했습니다. Pretendard 바이너리는 동봉하지 않으며 시스템 글꼴로 표시합니다. 인라인 SVG 마크·아이콘은 기존 소스 그대로입니다. 확인 없이 특정 아이콘 패키지의 저작자나 라이선스를 새로 지정하지 않았습니다.

금융 시세, 뉴스, 공시, 리포트와 기타 외부 데이터의 사용 조건은 소프트웨어 라이선스와 별개입니다. 공개본에는 그러한 수집 데이터와 실제 응답 fixture를 포함하지 않습니다. `LICENSES/`의 원문에 포함된 제3자 저작권자·기여자 표시는 해당 고지 보존의 일부입니다.

이 파일은 설치 파일에서 확인한 범위와 남은 확인 항목을 기록하며, 모든 외부 구성요소에 대한 법적 승인이나 재배포 검증 완료를 뜻하지 않습니다.
