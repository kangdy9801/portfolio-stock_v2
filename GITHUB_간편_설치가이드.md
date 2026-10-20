# GitHub Pages 빠른 배포 (FOLIO v5)

1. `FOLIO_v5_무역산업_전체배포.zip`을 내려받아 **압축 해제**합니다.
2. [GitHub](https://github.com/new)에서 Public 저장소 `folio-stock`을 생성합니다.
3. 압축 푼 폴더 안의 `index.html`, `assets`, `data`, `scripts`, `.github`, `.nojekyll`, `requirements.txt` 등의 **내용물**을 저장소 루트에 업로드합니다.
4. `Settings → Pages → Build and deployment → Source → GitHub Actions`로 설정합니다.
5. `Actions → Update Stock Prices and Deploy → Run workflow`를 누릅니다.
6. 배포 성공 후 `https://아이디.github.io/folio-stock/`로 접속하세요.

이 사이트의 보고서 탭에는 산업통상부 8·9월 수출입 PDF와 국가데이터처 7·8월 산업활동 PDF의 비교 데이터가 미리 등록돼 있습니다. PDF 파일은 사이트로 직접 업로드해 월별로 축적할 수 있습니다(수치 검토 후 저장). 소비자물가는 별도 분석합니다.

**원본 PDF, 개인 주식 보유내역, 배당 수령 내역, JSON 백업은 Public GitHub 저장소에 올리지 마세요.**
