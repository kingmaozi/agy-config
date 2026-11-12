import time, json, numpy as np, mlx.core as mx
from mlx_vlm.embedding_loader import load_embedding_model
from mlx_vlm.utils import get_model_path
from transformers import AutoTokenizer
path=get_model_path("mlx-community/embeddinggemma-2-8bit"); model=load_embedding_model(path); tok=AutoTokenizer.from_pretrained(path)

docs=["mybaby 项目决定使用 uv 管理 Python 依赖，虚拟环境放在 .venv","PowerContext 记忆服务运行在 127.0.0.1:17429，使用 SQLite 存储","T3 Code 中文版是 deepfry666/t3code-cn 的 0.1.8-cn.2","今天天气很好，适合去海边散步","Python 读取 JSON：with open('x.json') as f: data = json.load(f)"]
queries=["这个项目用什么管理 Python 包","记忆服务的端口是多少","中文版 T3 的安装包版本","海边天气怎么样","Python 怎么读取 JSON 文件"]
def emb(texts,n=3):
    inp=tok(texts,padding=True,return_tensors="np")
    ts=[]
    for _ in range(n):
        t0=time.time(); out=model(**{k:mx.array(v) for k,v in inp.items()}).text_embeds; mx.eval(out); ts.append(time.time()-t0)
    a=np.array(out.astype(mx.float32),dtype=np.float32); a=a/np.maximum(np.linalg.norm(a,axis=1,keepdims=True),1e-12)
    return a,ts
for mode in ["none","query","doc"]:
    qs=[q if mode=="none" else ("task: search result | query: " if mode=="query" else "title: none | text: ")+q for q in queries]
    ds=[d if mode=="none" else ("title: none | text: " if mode=="doc" else "task: search result | query: ")+d for d in docs]
    q,qt=emb(qs); d,dt=emb(ds)
    sims=q@d.T; top=sims.argmax(axis=1); acc=float((top==np.arange(len(queries))).mean())
    margins=[round(float(sims[i,top[i]]-np.max(np.delete(sims[i],top[i]))),4) for i in range(len(queries))]
    print(mode,"acc",acc,"top",top.tolist(),"margins",margins,"q_ms",round(np.median(qt)*1000,1),"d_ms",round(np.median(dt)*1000,1))
