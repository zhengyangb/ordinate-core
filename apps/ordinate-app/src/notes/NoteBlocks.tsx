import type {ReactNode} from "react";
import type {NoteBlock,NoteInline} from "@ordinate/core";

function inlines(nodes:NoteInline[]):ReactNode {
  return nodes.map((node,index)=>node.kind==="text"?node.text:node.kind==="strong"
    ? <strong key={index}>{inlines(node.children)}</strong> : <em key={index}>{inlines(node.children)}</em>);
}
/** Shared safe rendering for saved notes and import previews. Never interpret HTML. */
export function NoteBlocks({blocks}:{blocks:NoteBlock[]}){
  return <>{blocks.map((block,i)=>{
    if(block.kind==="paragraph") return <p key={i}>{inlines(block.children)}</p>;
    if(block.kind==="rule") return <hr key={i}/>;
    const items=block.items.map((item,j)=><li key={j}>{inlines(item)}</li>);
    return block.kind==="orderedList"?<ol key={i} start={block.start}>{items}</ol>:<ul key={i}>{items}</ul>;
  })}</>;
}
