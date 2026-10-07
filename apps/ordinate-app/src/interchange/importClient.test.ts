import {afterEach,describe,expect,it,vi} from "vitest";
import {ImportClient} from "./importClient";

class TestWorker {
  static current:TestWorker;
  onmessage:((event:{data:unknown})=>void)|null=null;
  onerror:(()=>void)|null=null;
  postMessage=vi.fn();terminate=vi.fn();
  constructor(){TestWorker.current=this;}
}
afterEach(()=>vi.unstubAllGlobals());
describe("background import session",()=>{
  it("correlates replies, including out-of-order failures",async()=>{
    vi.stubGlobal("Worker",TestWorker);const client=new ImportClient();
    const first=client.request({kind:"prepare",file:{name:"a.csv",bytes:new Uint8Array()},valueMode:"text"});
    const second=client.request({kind:"configure",headers:[],notes:[]});
    const failure=expect(second).rejects.toThrow("invalid header");
    TestWorker.current.onmessage!({data:{id:2,error:"invalid header"}});
    const result={ok:false,diagnostics:[]};TestWorker.current.onmessage!({data:{id:1,result}});
    await expect(first).resolves.toEqual(result);await failure;client.dispose();
  });
  it("terminates work and rejects pending requests when the dialog closes",async()=>{
    vi.stubGlobal("Worker",TestWorker);const client=new ImportClient();
    const request=client.request({kind:"configure",headers:[],notes:[]});
    const failure=expect(request).rejects.toThrow("closed");client.dispose();await failure;
    expect(TestWorker.current.terminate).toHaveBeenCalledOnce();
    await expect(client.request({kind:"configure",headers:[],notes:[]})).rejects.toThrow("closed");
  });
  it("reports worker startup failure without hanging",async()=>{
    vi.stubGlobal("Worker",TestWorker);const client=new ImportClient();
    const request=client.request({kind:"configure",headers:[],notes:[]});
    const failure=expect(request).rejects.toThrow("processing stopped");TestWorker.current.onerror!();await failure;
  });
});
