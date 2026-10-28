export function browserPushState({secure,notification,worker,push,permission,serverReady}){
 if(!secure)return {available:false,message:'브라우저 알림에는 HTTPS가 필요합니다. 사이트 내 알림은 사용할 수 있습니다.'};
 if(!notification||!worker||!push)return {available:false,message:'이 브라우저는 푸시 알림을 지원하지 않습니다. 사이트 내 알림은 사용할 수 있습니다.'};
 if(permission==='denied')return {available:false,message:'알림 권한이 거부되어 있습니다. 브라우저 사이트 설정에서 변경할 수 있습니다. 사이트 내 알림은 계속 제공됩니다.'};
 if(!serverReady)return {available:false,message:'브라우저 푸시 서버 설정이 필요합니다. 사이트 내 알림은 사용할 수 있습니다.'};
 return {available:true,message:''};
}
