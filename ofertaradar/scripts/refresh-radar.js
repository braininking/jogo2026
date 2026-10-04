const https=require("https");
const url=process.env.OFERTARADAR_URL||"https://ofertaradar.onrender.com/api/radar";
https.get(url,res=>{let data="";res.on("data",d=>data+=d);res.on("end",()=>{if(res.statusCode>=400){console.error("Radar HTTP",res.statusCode,data);process.exit(1)}console.log("Radar atualizado:",new Date().toISOString())})}).on("error",err=>{console.error(err);process.exit(1)});