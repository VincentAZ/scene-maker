import base from '../vite.config';
const api={target:'http://127.0.0.1:4499',changeOrigin:false};
export default {...base,server:{...base.server,hmr:false,watch:{ignored:['**']},proxy:{'/api':api,'/uploads':api,'/engine':api,'/exports':api,'/library':api,'/content':api}}};
