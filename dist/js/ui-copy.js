// Shared status vocabulary. A failed request must never be described as an empty result.
export const uiStates = Object.freeze({
 disconnected: ['API 설정 필요', '데이터 공급사 연결 설정을 확인해 주세요.', 'globe'],
 restricted: ['이용 권한 확인 필요', '데이터 공개 표시 권한을 확인해 주세요.', 'info'],
 empty: ['조건에 맞는 자료가 없습니다', '기간이나 필터를 변경해 보세요.', 'search'],
 error: ['연결 오류', '자료를 불러오지 못했습니다. 다시 시도해 주세요.', 'alert'],
 incomplete: ['일부 항목 미제공', '공급사에서 제공하지 않은 값은 표시하지 않습니다.', 'grid'],
 loading: ['자료 불러오는 중', '데이터 기준 시각을 확인하고 있습니다.', 'refresh'],
 unpublished: ['아직 발표되지 않았습니다', '발표 후 확인된 자료를 표시합니다.', 'clock'],
 closed: ['시장 휴장', '마지막 거래일의 시세와 기준일을 표시합니다.', 'clock'],
 delayed: ['시세 지연', '표시된 기준 시각을 확인해 주세요.', 'clock'],
});
export function uiState(kind) { return uiStates[kind] || uiStates.error; }
