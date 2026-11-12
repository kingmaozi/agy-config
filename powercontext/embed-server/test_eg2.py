import time, numpy as np, mlx.core as mx
from mlx_vlm.embedding_loader import load_embedding_model
from mlx_vlm.utils import get_model_path
from transformers import AutoTokenizer
name="mlx-community/embeddinggemma-2-8bit"
t0=time.time(); path=get_model_path(name); model=load_embedding_model(path); tok=AutoTokenizer.from_pretrained(path); print("load",round(time.time()-t0,1),"s")
qs=["task: search result | query: mybaby 项目的 Python 依赖管理用什么","task: search result | query: 这个项目怎么安装 Python 包"]
docs=["title: none | text: mybaby 项目决定使用 uv 管理 Python 依赖，虚拟环境放在 .venv","title: none | text: 数据库使用 SQLite，端口 17429","title: none | text: 今天天气很好，适合去海边"]
def emb(texts,n=3):
    inp=tok(texts,padding=True,return_tensors="np")
    ts=[]
    for _ in range(n):
        t0=time.time(); out=model(**{k:mx.array(v) for k,v in inp.items()}).text_embeds; mx.eval(out); ts.append(time.time()-t0)
    a=np.array(out.astype(mx.float32),dtype=np.float32)
    a=a/np.maximum(np.linalg.norm(a,axis=1,keepdims=True),1e-12)
    return a,ts
q,qt=emb(qs); d,dt=emb(docs)
print("dim",q.shape,"q_ms",[round(x*1000,1) for x in qt],"d_ms",[round(x*1000,1) for x in dt])
for i in range(len(qs)):
    print("Q",i,"sims",[round(float(q[i]@x),4) for x in d])
# plain, no prefixes
plain=["mybaby 项目决定使用 uv 管理 Python 依赖","数据库使用 SQLite，端口 17429","今天天气很好"]
pq=["mybaby 项目的 Python 依赖管理用什么","这个项目怎么安装 Python 包"]
pe,_=emb(plain); pqv,_=emb(pq)
print("plain sims",[[round(float(pq[i]@x),4) for x in pe] for i in range(len(pq))])
