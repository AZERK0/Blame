import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import test from 'node:test';
import { projectImageContext } from "./image-context.js";
import type { Message } from "@cline/sdk";
import { createHandler } from "@cline/llms";

const project = projectImageContext;
type NativeImage = { type: "image"; mediaType: string; data: string };
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const imageCount = (messages: Message[]) => nativeImages(messages).length;
const encodedBytes = (messages: Message[]) => nativeImages(messages).reduce((total, image) => total + image.data.length, 0);

function pngChunk(type: string, data: Buffer) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function imageFixture(id: number, padding = 0): NativeImage {
  const header = Buffer.from([0,0,0,1,0,0,0,1,8,2,0,0,0]);
  const data = deflateSync(Buffer.from([0,id,128,255-id]));
  const chunks = [pngChunk('IHDR',header), pngChunk('tEXt',Buffer.from(`fixture\0${String(id).padStart(3,'0')}${'x'.repeat(padding)}`)), pngChunk('IDAT',data), pngChunk('IEND',Buffer.alloc(0))];
  const bytes = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),...chunks]);
  return {type:'image',mediaType:'image/png',data:bytes.toString('base64')};
}

function conversation(images: NativeImage[]): Message[] {
  return images.flatMap((image,index)=>[
    {role:'assistant',content:[{type:'tool_use',id:`read-${index}`,name:'read_code',input:{target:`image-${index}.png`}}]},
    {role:'user',content:[{type:'tool_result',tool_use_id:`read-${index}`,name:'read_code',content:[{type:'text',text:`image-${index}.png`},image]}]},
  ]);
}

function nativeImages(value: unknown): NativeImage[] {
  if (!value || typeof value !== 'object') return [];
  const image = value as Record<string, unknown>;
  if (image.type === "image" && typeof image.data === "string" && typeof image.mediaType === "string") return [image as NativeImage];
  return Object.values(value).flatMap(nativeImages);
}

async function capture(messages: Message[]) {
  let body: Record<string, unknown> | undefined;
  const handler = createHandler({providerId:'openai-codex',modelId:'gpt-5.6-luna',apiKey:'offline-placeholder',accessToken:'offline-placeholder',baseUrl:'https://offline.invalid',fetch:async(input: Parameters<typeof fetch>[0],init?: RequestInit)=>{
    assert.equal(String(input),'https://offline.invalid/responses');
    assert.equal(typeof init?.body, "string");
    body=JSON.parse(init!.body as string);
    return new Response('{"error":{"message":"Offline capture","type":"invalid_request_error"}}',{status:400,headers:{'content-type':'application/json'}});
  }});
  try {
    for await (const part of handler.createMessage('Inspect images.',messages,[]))
      assert.ok(part.type === 'error' || part.type === 'done');
  } catch (error) { assert.match(String(error), /Offline capture/); }
  assert.ok(body,'Missing offline provider request');
  return JSON.stringify(body.input);
}

const small=imageFixture(1);
const images=Array.from({length:6},(_,index)=>imageFixture(index+1,1024*1024));

test('duplicates retain one image without changing stored messages',()=>{
  const messages=conversation([small,small]);
  const original=digest(messages);
  assert.equal(imageCount(project(messages)),1);
  assert.equal(digest(messages),original);
});

test('image descriptors in tool arguments remain untouched',()=>{
  const message={role:'assistant',content:[{type:'tool_use',id:'write',name:'save_fixture',input:{content:small}}]};
  const result=project([...conversation([small]),message]);
  assert.equal(digest(result.at(-1)),digest(message));
});

test('nested output images share the same budget',()=>{
  const message={role:'user',content:[{type:'tool_result',tool_use_id:'nested',name:'read_code',content:{nested:[small,{screenshot:small}]}}]};
  assert.equal(imageCount(project([message])),1);
});

test('new distinct images remain visible when history reaches the media limit',()=>{
  const result=project(conversation(images));
  assert.ok(encodedBytes(result)<=8*1024*1024);
  assert.ok(nativeImages(result).some(image=>image.data===images.at(-1)!.data));
  assert.equal(nativeImages(result).some(image=>image.data===images[0].data),false);
});

test('reading an old image again restores its priority',()=>{
  const result=project(conversation([...images,images[0]]));
  assert.ok(encodedBytes(result)<=8*1024*1024);
  assert.ok(nativeImages(result).some(image=>image.data===images[0].data));
  assert.equal(nativeImages(result).some(image=>image.data===images[1].data),false);
});

test('ordinary appended text preserves the existing provider prefix',()=>{
  const messages=conversation(images.slice(0,3));
  const prefix=project(messages);
  const result=project([...messages,{role:'user',content:'Continue.'}]);
  assert.equal(digest(result.slice(0,prefix.length)),digest(prefix));
});

test('a duplicate read preserves the existing prefix below the budget',()=>{
  const messages=conversation(images.slice(0,3));
  const prefix=project(messages);
  const result=project([...messages,...conversation([images[0]])]);
  assert.equal(digest(result.slice(0,prefix.length)),digest(prefix));
  assert.equal(imageCount(result),3);
});

test('projection is idempotent after omissions',()=>{
  const result=project(conversation([...images,...images]));
  assert.equal(digest(project(result)),digest(result));
});

test('one native PNG reaches the actual SDK request',async()=>{
  const body=await capture(project(conversation([small])));
  assert.equal(body.split('"type":"input_image"').length-1,1);
  assert.equal(body.includes('[media omitted:'),false);
});

test('duplicate history no longer triggers SDK media omission',async()=>{
  const subset=images.slice(0,5);
  const body=await capture(project(conversation([...subset,...subset])));
  assert.equal(body.includes('[media omitted:'),false);
  assert.equal(body.split('"type":"input_image"').length-1,5);
});

test('the latest distinct image reaches the actual SDK request',async()=>{
  const body=await capture(project(conversation([...images.slice(0,5),...images.slice(0,5),images[5]])));
  assert.equal(body.includes(images[5].data),true);
  assert.equal(body.includes('[media omitted:'),false);
});
