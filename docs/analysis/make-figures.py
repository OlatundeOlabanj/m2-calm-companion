import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt, numpy as np
plt.rcParams.update({'font.family':'DejaVu Serif','font.size':9,'axes.spines.top':False,'axes.spines.right':False})
# Fig A: tension vs breathing rise for several pulse rises (floors at scale 1.5 and 3)
fig,ax=plt.subplots(figsize=(5.6,3.1),dpi=200)
x=np.linspace(0,10,200)
for dp,ls,c in [(0,'-','#222222'),(6,'--','#1f5f8b'),(12,'-.','#9a4a00'),(24,':','#2a7a3b')]:
    t=np.clip(100*(0.6*np.maximum(0,x/1.5)+0.4*max(0,dp/3))/4,0,100)
    ax.plot(x,t,ls,color=c,lw=1.6,label=f'pulse +{dp} bpm')
ax.axhline(55,color='#777',lw=0.8); ax.text(0.15,57,'lock level 55',fontsize=8,color='#555')
ax.axhline(30,color='#777',lw=0.8); ax.text(0.15,32,'review level 30',fontsize=8,color='#555')
ax.set_xlabel('Breathing rate above calm (breaths per minute)'); ax.set_ylabel('Tension score T')
ax.set_ylim(0,104); ax.set_xlim(0,10); ax.legend(frameon=False,fontsize=8,loc='lower right')
fig.tight_layout(); fig.savefig('docs/analysis/out/tension.png'); plt.close()
# Fig B: gate trace with smoother
def smooth(seq,a=0.3):
    v=None;out=[]
    for x in seq:
        v=x if v is None else v+a*(x-v); out.append(v)
    return out
raw=[0]*5+[70]*25+[20]*30
T=smooth(raw)
# gate sim
high=low=0;state='open';states=[]
for t in T:
    if t>=55: high+=1;low=0
    elif t<30: low+=1;high=0
    else: high=max(0,high-1);low=max(0,low-1)
    if state=='open' and high>=3: state='locked';low=0
    elif state=='locked' and low>=8: state='review'
    states.append(state)
fig,ax=plt.subplots(figsize=(5.6,3.1),dpi=200)
tt=np.arange(1,61)
ax.step(tt,raw,where='post',color='#999',lw=1.2,label='raw tension')
ax.plot(tt,T,color='#222',lw=1.8,label='smoothed (alpha 0.3)')
ax.axhline(55,color='#777',lw=0.8,ls='--'); ax.axhline(30,color='#777',lw=0.8,ls='--')
lock=states.index('locked')+1; rev=states.index('review')+1
for tx,lab in [(lock,'locked'),(rev,'review')]:
    ax.axvline(tx,color='#9a4a00',lw=1.0); ax.text(tx+0.5,92,lab+f' (t={tx} s)',fontsize=8,color='#9a4a00')
ax.set_xlabel('Time (seconds, one reading per second)'); ax.set_ylabel('Tension'); ax.set_ylim(0,100); ax.set_xlim(0,60)
ax.legend(frameon=False,fontsize=8,loc='center right')
fig.tight_layout(); fig.savefig('docs/analysis/out/gate_trace.png'); plt.close(); print(lock,rev)
