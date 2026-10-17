"""Body-keypoint network input: the native byte-linear resize and the coarse-net tensor.

QCut-owned NumPy port. The photo is scaled so its long side becomes 224 (content size
rounded, each tensor side then rounded up to a multiple of 16), centred with zero
padding, channels reversed to BGR and offset by -128 into an int16 tensor. Four-channel
sources take the 11-bit linear path with its two truncated vertical products; exact
halvings take the 2x2 area fast path; three-channel sources use a 7-bit path. Verified
on 2,000 resize cases and whole network inputs from real renders.
"""
import numpy as np
F=np.float32

def _axis(size,out,vertical=False):
    # Native half-pixel coordinate is rounded to float32 before flooring.
    coordinate=np.asarray((np.arange(out,dtype=np.float64)+.5)*(size/out)-.5,np.float32)
    index=np.floor(coordinate).astype(np.int64)
    fraction=F(coordinate-index.astype(np.float32))
    below=index<0;above=index>=size-1
    next_index=np.clip(index+1,0,size-1)
    index=np.clip(index,0,size-1)
    if not vertical:fraction[below|above]=F(0)
    first=np.rint(F(F(1)-fraction)*F(2048)).astype(np.int64)
    second=np.rint(F(fraction*F(2048))).astype(np.int64)
    return index,next_index,first,second

def resize_linear_u8(image,out_h,out_w,roi=None):
    a=np.asarray(image)
    if a.dtype!=np.uint8 or a.ndim!=3 or not 1<=a.shape[2]<=4:raise ValueError('uint8 HxWxC, C=1..4 required')
    if roi is not None:
        x,y,w,h=map(int,roi)
        if x<0 or y<0 or min(w,h)<=0 or x+w>a.shape[1] or y+h>a.shape[0]:raise ValueError('bounded integer ROI required')
        a=a[y:y+h,x:x+w]
    if min(out_h,out_w)<=0 or max(out_h,out_w)>8192:raise ValueError('bounded positive output dimensions required')
    h,w,c=a.shape
    if h==out_h and w==out_w:return a.copy()
    # Three-channel mobilecv2 has a separate 7-bit, byte-intermediate path.
    if c==3 and min(h,w)>1:
        def axis7(size,out):
            coordinate=np.asarray((np.arange(out,dtype=np.float64)+.5)*(size/out)-.5,np.float32)
            index=np.floor(coordinate).astype(np.int64)
            fraction=F(coordinate-index.astype(np.float32))
            return np.clip(index,0,size-1),np.clip(index+1,0,size-1),np.rint(F(F(1)-fraction)*F(128)).astype(np.int64),np.rint(F(fraction*F(128))).astype(np.int64)
        ix,jx,a0,a1=axis7(w,out_w);iy,jy,b0,b1=axis7(h,out_h)
        horizontal=(a[:,ix].astype(np.int64)*a0[None,:,None]+a[:,jx].astype(np.int64)*a1[None,:,None])>>7
        return ((horizontal[iy]*b0[:,None,None]+horizontal[jy]*b1[:,None,None])>>7).astype(np.uint8)
    # Native linear uses the exact two-by-two area fast path for this special ratio.
    if h==2*out_h and w==2*out_w:
        total=a[0::2,0::2].astype(np.int32)+a[0::2,1::2]+a[1::2,0::2]+a[1::2,1::2]
        return np.rint(total*.25).astype(np.uint8) if c==2 else ((total+2)>>2).astype(np.uint8)
    ix,jx,alpha0,alpha1=_axis(w,out_w);iy,jy,beta0,beta1=_axis(h,out_h,vertical=True)
    horizontal=a[:,ix].astype(np.int64)*alpha0[None,:,None]+a[:,jx].astype(np.int64)*alpha1[None,:,None]
    # Byte vertical kernel uses two separately truncated products, not a single
    # full precision bilinear sum with one final rounding operation.
    top=((horizontal[iy]>>4)*beta0[:,None,None])>>16
    bottom=((horizontal[jy]>>4)*beta1[:,None,None])>>16
    return np.clip((top+bottom+2)>>2,0,255).astype(np.uint8)

def skeleton005(image,out_h=224,out_w=128,roi=None):
    a=np.asarray(image)
    if a.ndim!=3 or a.shape[2]!=3:raise ValueError('RGB source required')
    if roi is None:h,w=a.shape[:2]
    else:_,_,w,h=map(int,roi)
    # Letterbox content dimensions are selected explicitly by aspect fit.
    scale=min(out_w/w,out_h/h)
    content_w=max(1,min(out_w,int(round(w*scale))))
    content_h=max(1,min(out_h,int(round(h*scale))))
    rgba=np.concatenate((a,np.full((*a.shape[:2],1),255,np.uint8)),axis=-1)
    resized=resize_linear_u8(rgba,content_h,content_w,roi)[...,:3]
    tensor=np.zeros((out_h,out_w,3),np.int16)
    left=(out_w-content_w)//2;top=(out_h-content_h)//2
    tensor[top:top+content_h,left:left+content_w]=resized[...,::-1].astype(np.int16)-128
    return tensor,{'source_size':[w,h],'content_size':[content_w,content_h],'padding_ltrb':[left,top,out_w-content_w-left,out_h-content_h-top],'profile':'NHWC int16, RGB -> RGBA byte resize (C4 profile) -> BGR -> subtract128 -> zero-domain padding'}

def skeleton005_auto(image,roi=None,target=224):
    if target!=224:raise ValueError('only actual SDK target224 profile has been validated')
    a=np.asarray(image)
    if roi is None:h,w=a.shape[:2]
    else:_,_,w,h=map(int,roi)
    if min(w,h)<=0:raise ValueError('positive source dimensions required')
    content_w=max(1,int(round(w*target/max(w,h))))
    content_h=max(1,int(round(h*target/max(w,h))))
    out_w=((content_w+15)//16)*16;out_h=((content_h+15)//16)*16
    if min(out_w,out_h)<32:raise ValueError('native SDK aspect-ratio region with short side<32 is unvalidated/unsupported')
    result,receipt=skeleton005(image,out_h,out_w,roi)
    receipt.update(target=target,alignment=16,policy='scale long side224 -> round content dimensions -> ceil each to16')
    return result,receipt
