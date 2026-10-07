import type { ExcelNoteChoice, ImportSheetHeaders } from "@ordinate/core";
import type { ImportFile } from "./contracts";
import { configureImport, prepareImportSource, type ImportSource, type PreparedImport, type Review } from "./conversion";

export type ImportRequest = {id:number} & (
  {kind:"prepare"; file:ImportFile; valueMode:"text"|"infer"; headers?:ImportSheetHeaders[]} |
  {kind:"configure"; headers:ImportSheetHeaders[]; notes:ExcelNoteChoice[]});
export type ImportResponse = {id:number} & ({result:Review<PreparedImport>} | {error:string});
let source:ImportSource | null=null;
// Serialize requests so a new selection cannot race the source it configures.
let pending=Promise.resolve();
self.onmessage=(event:MessageEvent<ImportRequest>)=>{
  pending=pending.then(async()=>{
    const request=event.data;
    let response:ImportResponse;
    try {
      let result:Review<PreparedImport>;
      if(request.kind==="prepare") {
        source=null;
        const prepared=await prepareImportSource(request.file,request.valueMode);
        if(prepared.ok){source=prepared.value;result=await configureImport(source,request.headers);}
        else result=prepared;
      } else {
        if(!source) throw new Error("Prepare an import before changing its settings.");
        result=await configureImport(source,request.headers,request.notes);
      }
      response={id:request.id,result};
    } catch(error){response={id:request.id,error:error instanceof Error?error.message:String(error)};}
    self.postMessage(response);
  });
};
