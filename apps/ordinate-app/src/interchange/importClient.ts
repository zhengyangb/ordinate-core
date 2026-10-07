import type { ImportRequest, ImportResponse } from "./importWorker";
import type { PreparedImport, Review } from "./conversion";
type Request = ImportRequest extends infer T ? T extends ImportRequest ? Omit<T,"id"> : never : never;

/** Owns one import session; decoded workbook data never crosses into the renderer. */
export class ImportClient {
  private worker=new Worker(new URL("./importWorker.ts",import.meta.url),{type:"module"});
  private nextId=0;
  private closed=false;
  private pending=new Map<number,{resolve:(result:Review<PreparedImport>)=>void;reject:(error:Error)=>void}>();
  constructor(){
    this.worker.onmessage=(event:MessageEvent<ImportResponse>)=>{
      const response=event.data, pending=this.pending.get(response.id);
      if(!pending)return;
      this.pending.delete(response.id);
      if("error" in response)pending.reject(new Error(response.error));else pending.resolve(response.result);
    };
    this.worker.onerror=()=>this.dispose(new Error("Import processing stopped. Close this dialog and try again."));
  }
  request(request:Request):Promise<Review<PreparedImport>>{
    if(this.closed)return Promise.reject(new Error("Import session is closed."));
    const id=++this.nextId;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{resolve,reject});
      this.worker.postMessage({...request,id});
    });
  }
  dispose(error=new Error("Import session closed.")){
    this.closed=true;this.worker.terminate();
    for(const pending of this.pending.values())pending.reject(error);
    this.pending.clear();
  }
}
