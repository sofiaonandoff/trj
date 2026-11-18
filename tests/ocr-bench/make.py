import json, random, math, os, sys
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'out')+'/'
os.makedirs(OUT,exist_ok=True)
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance
random.seed(7)
# Noto Sans CJK와 DejaVu Sans 글꼴이 필요하다 (경로는 환경 변수로 바꿀 수 있다)
SANS=os.environ.get('CJK_FONT','/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'); SANSB=os.environ.get('CJK_BOLD','/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc')
MONO=os.environ.get('MONO_FONT','/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf')
def F(path,size,idx=1): return ImageFont.truetype(path,size,index=idx) if path.endswith('ttc') else ImageFont.truetype(path,size)
def receipt(lines, w=620, title=None, tsize=40, size=26, font=MONO, kfont=SANS, idx=1, bg='white'):
    h=140+len(lines)*int(size*1.7)
    im=Image.new('RGB',(w,h),bg); d=ImageDraw.Draw(im); y=40
    if title:
        f=F(SANSB,tsize,idx); tw=d.textlength(title,font=f); d.text(((w-tw)/2,y),title,font=f,fill='black'); y+=int(tsize*1.8)
    for l in lines:
        f=F(kfont,size,idx) if any(ord(c)>0x2000 for c in l) else F(font,size)
        d.text((40,y),l,font=f,fill=(30,30,30)); y+=int(size*1.7)
    return im
def photo(im, angle=2.5, blur=0.8, contrast=0.75, shade=True, scale=0.75, noise=6):
    # 종이 영수증을 손으로 찍은 것처럼: 기울기, 흐림, 그림자, 대비 저하, 축소
    im=im.convert('RGB')
    bg=Image.new('RGB',(int(im.width*1.25),int(im.height*1.15)),(120,110,95))
    bg.paste(im,((bg.width-im.width)//2,(bg.height-im.height)//2))
    im=bg.rotate(angle,resample=Image.BICUBIC,fillcolor=(120,110,95))
    if shade:
        g=Image.linear_gradient('L').resize(im.size).rotate(35)
        g=ImageEnhance.Brightness(g).enhance(0.55)
        im=Image.composite(im, Image.new('RGB',im.size,(0,0,0)), g.point(lambda v: 150+v*105//255))
    im=ImageEnhance.Contrast(im).enhance(contrast)
    im=im.filter(ImageFilter.GaussianBlur(blur))
    px=im.load()
    for _ in range(im.width*im.height//40):
        x=random.randrange(im.width); y=random.randrange(im.height); r,g2,b=px[x,y]; n=random.randint(-noise,noise)*3
        px[x,y]=(max(0,min(255,r+n)),max(0,min(255,g2+n)),max(0,min(255,b+n)))
    return im.resize((int(im.width*scale),int(im.height*scale)))
def screen(rows, w=390, scale=2, bg=(255,255,255), muted=(120,120,120), idx=1):
    # 앱 화면 캡처: 작은 회색 글자, 큰 제목
    h=60+sum(int(r[1]*1.9) for r in rows)
    im=Image.new('RGB',(w*scale,h*scale),bg); d=ImageDraw.Draw(im); y=30*scale
    for text,size,bold,gray in rows:
        f=F(SANSB if bold else SANS,size*scale,idx); d.text((20*scale,y),text,font=f,fill=muted if gray else (20,20,20)); y+=int(size*1.9*scale)
    return im
S=[]
def add(name,im,truth): im.save(f'{OUT}{name}.jpg',quality=85); S.append({'file':name+'.jpg',**truth})

r=receipt(['392/37 Maharat Rd, Bangkok','Tel 02-622-2005','Date 04/12/2026  14:31','------------------------------','Iced Latte          120.00','Butterfly Pea Tea    95.00','------------------------------','Subtotal            215.00','VAT 7%               15.05','TOTAL THB           230.05','Cash                500.00','Change              269.95'],title='Blue Whale Cafe')
add('01_clean_en',r,{'name':'Blue Whale Cafe','date':'2026-12-04','amount':230.05,'currency':'THB'})
add('02_photo_en',photo(r),{'name':'Blue Whale Cafe','date':'2026-12-04','amount':230.05,'currency':'THB'})
add('03_photo_en_hard',photo(r,angle=-4,blur=1.3,contrast=0.6,scale=0.55),{'name':'Blue Whale Cafe','date':'2026-12-04','amount':230.05,'currency':'THB'})
k=receipt(['서울 중구 명동10길 29','사업자 201-81-12345','2026-12-02 12:10','------------------------------','칼국수 2         22,000','만두 1            12,000','------------------------------','공급가액          30,909','부가세             3,091','합계              34,000원','카드결제          34,000'],title='명동교자 본점',idx=1)
add('04_clean_ko',k,{'name':'명동교자 본점','date':'2026-12-02','amount':34000,'currency':'KRW'})
add('05_photo_ko',photo(k,angle=2,blur=0.9,contrast=0.7,scale=0.7),{'name':'명동교자 본점','date':'2026-12-02','amount':34000,'currency':'KRW'})
j=receipt(['東京都渋谷区道玄坂2-1','2026年12月3日 20:14','------------------------------','とんこつラーメン    ¥1,100','餃子                ¥450','生ビール            ¥650','------------------------------','小計              ¥2,200','合計              ¥2,200','お預り            ¥5,000','お釣り            ¥2,800'],title='一蘭 渋谷店',idx=0)
add('06_clean_ja',j,{'name':'一蘭 渋谷店','date':'2026-12-03','amount':2200,'currency':'JPY','langs':'jpn'})
add('07_photo_ja',photo(j,angle=-2,blur=0.8,contrast=0.75,scale=0.7),{'name':'一蘭 渋谷店','date':'2026-12-03','amount':2200,'currency':'JPY','langs':'jpn'})
g=screen([('Your Grab ride',26,True,False),('Thu, 3 Dec 2026, 9:41 PM',15,False,True),('Pickup  Siam Paragon',15,False,True),('Drop-off  Asok BTS',15,False,True),('Fare',15,False,True),('Total paid   ฿250.00',20,True,False)])
add('08_screen_grab',g,{'name':None,'date':'2026-12-03','amount':250,'currency':'THB','costOnly':True})
h=screen([('예약 확정',24,True,False),('아바니 리버사이드 방콕 호텔',20,True,False),('체크인 2026.12.02 (수) 15:00',15,False,True),('체크아웃 2026.12.05 (토) 12:00',15,False,True),('예약번호 1234567890',15,False,True),('객실 디럭스 킹 1실, 3박',15,False,True),('총 결제금액 ₩482,300',18,True,False)])
add('09_screen_hotel_ko',h,{'name':'아바니 리버사이드 방콕 호텔','date':'2026-12-02','amount':482300,'currency':'KRW','code':'1234567890'})
fl=screen([('E-TICKET RECEIPT',22,True,False),('Booking reference  K7Q2LM',15,False,True),('KE651  ICN → BKK',20,True,False),('02DEC26  18:25 - 22:10',16,False,False),('Seat 34A   Economy',15,False,True)])
add('10_screen_flight',fl,{'flight':'KE651','date':'2026-12-02','code':'K7Q2LM'})
t=screen([('Wat Arun admission',22,True,False),('Ticket for 2 adults',15,False,True),('Visit date: Dec 4, 2026',15,False,True),('Order no. WA-88213',15,False,True),('Total THB 200',18,True,False)])
add('11_screen_ticket',t,{'name':'Wat Arun admission','date':'2026-12-04','amount':200,'currency':'THB','code':'WA-88213'})
sm=screen([('7-ELEVEN',20,True,False),('04/12/2569 08:05',13,False,True),('Water 600ml        14.00',13,False,True),('Sandwich           39.00',13,False,True),('TOTAL              53.00',14,True,False)],w=300,scale=1)
add('12_small_lowres',sm,{'name':'7-ELEVEN','date':'2026-12-04','amount':53,'currency':'THB'})
json.dump(S,open(OUT+'truth.json','w'),ensure_ascii=False,indent=1)
print(len(S))

# 더 어려운 경우
add('13_thermal_faded',photo(r,angle=1,blur=1.4,contrast=0.35,scale=0.6,noise=10),{'name':'Blue Whale Cafe','date':'2026-12-04','amount':230.05,'currency':'THB'})
add('14_rotated7',photo(r,angle=7,blur=0.8,contrast=0.7,scale=0.7),{'name':'Blue Whale Cafe','date':'2026-12-04','amount':230.05,'currency':'THB'})
add('15_photo_ko_hard',photo(k,angle=-5,blur=1.4,contrast=0.5,scale=0.5,noise=10),{'name':'명동교자 본점','date':'2026-12-02','amount':34000,'currency':'KRW'})
tiny=g.resize((g.width//3,g.height//3)); add('16_tiny_screen',tiny,{'date':'2026-12-03','amount':250,'currency':'THB','costOnly':True})
add('17_hotel_photo_screen',photo(h,angle=-3,blur=1.0,contrast=0.7,scale=0.6,shade=False),{'name':'아바니 리버사이드 방콕 호텔','date':'2026-12-02','amount':482300,'currency':'KRW','code':'1234567890'})
dark=screen([('Starbucks Reserve',24,True,False),('ICONSIAM, Bangkok',15,False,True),('05 Dec 2026 10:12',15,False,True),('Caffe Latte (V)   165.00',15,False,False),('Total            ฿165.00',18,True,False)],bg=(28,28,30),muted=(150,150,150))
d2=Image.eval(dark,lambda v:v)  # 다크 모드 그대로
# 다크 모드 글자는 흰색이어야 하므로 다시 그린다
im=Image.new('RGB',dark.size,(28,28,30)); dd=ImageDraw.Draw(im); y=60
for text,size,bold,gray in [('Starbucks Reserve',24,True,False),('ICONSIAM, Bangkok',15,False,True),('05 Dec 2026 10:12',15,False,True),('Caffe Latte (V)   165.00',15,False,False),('Total            ฿165.00',18,True,False)]:
    dd.text((40,y),text,font=F(SANSB if bold else SANS,size*2,1),fill=(150,150,150) if gray else (240,240,240)); y+=int(size*3.8)
add('18_dark_mode',im,{'name':'Starbucks Reserve','date':'2026-12-05','amount':165,'currency':'THB'})
json.dump(S,open(OUT+'truth.json','w'),ensure_ascii=False,indent=1)
print(len(S))
