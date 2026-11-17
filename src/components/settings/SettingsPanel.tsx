import { useEffect,useMemo,useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useAppConfig,useLocale } from '@/config/hooks';
import { DEFAULT_CONFIG } from '@/config/default';
import type { ConfigOptions } from '@/config/default';
import { normalizeSettings,settingsSignature } from '@/config/settings-model';
import { defaultTexts } from '@/config/locales';
import { apiService } from '@/services/api';
import themeDefinition from '../../../komari-theme.json';
import SettingItem from './SettingItem';
import CustomTextsEditor from './CustomTextsEditor';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/useMobile';
import { toast } from 'sonner';

interface Props {isOpen:boolean;onClose:()=>void}
const EMPTY_PREVIEW:Partial<ConfigOptions>={};
export default function SettingsPanel({isOpen,onClose}:Props){
  const {t}=useLocale();
  const {publicSettings,updatePreviewConfig,reloadConfig}=useAppConfig();
  const saved=useMemo(()=>normalizeSettings(publicSettings?.theme_settings),[publicSettings?.theme_settings]);
  const savedKey=settingsSignature(saved);
  const [draft,setDraft]=useState<Partial<ConfigOptions>>(saved);
  const [page,setPage]=useState('main');
  const [textPage,setTextPage]=useState('main');
  const [preview,setPreview]=useState(true);
  const [saving,setSaving]=useState(false);
  const mobile=useIsMobile();
  const definitions=themeDefinition.configuration.data;
  const dirty=settingsSignature(draft)!==savedKey;
  const previewPayload=useMemo(()=>isOpen&&preview?draft:EMPTY_PREVIEW,[draft,isOpen,preview]);
  useEffect(()=>{
    if(isOpen){setDraft(saved);setPage('main');setTextPage('main');setPreview(true);}
  },[isOpen,saved]);
  useEffect(()=>{
    updatePreviewConfig(previewPayload);
  },[previewPayload,updatePreviewConfig]);
  useEffect(()=>()=>updatePreviewConfig({}),[updatePreviewConfig]);
  const close=()=>{if(saving)return;setDraft(saved);updatePreviewConfig({});onClose();};
  const save=async()=>{
    if(saving||!publicSettings?.theme)return;
    try{
      const validated=normalizeSettings(draft,true);
      setSaving(true);
      const result=await apiService.saveThemeSettings(publicSettings.theme,validated);
      if(result.status!=='success')throw new Error(result.message||t('setting.saveError'));
      updatePreviewConfig({});await reloadConfig();toast.success(t('setting.saveSuccess'));onClose();
    }catch(error){toast.error(error instanceof Error?error.message:t('setting.saveError'));}
    finally{setSaving(false);}
  };
  const change=(key:keyof ConfigOptions,value:unknown)=>setDraft(previous=>({...previous,[key]:value}));
  const exportDraft=()=>{
    const blob=new Blob([JSON.stringify(draft,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='purcarte-settings.json';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),0);
  };
  const importDraft=async(event:React.ChangeEvent<HTMLInputElement>)=>{
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    try{
      if(file.size>1024*1024)throw new Error('配置文件不能超过 1 MB');
      const imported=normalizeSettings(JSON.parse(await file.text()),true);
      setDraft({...saved,...imported});toast.success('配置已导入，点击保存后生效');
    }catch(error){toast.error(error instanceof Error?error.message:t('setting.importError'));}
  };
  if(!isOpen)return null;
  const start=definitions.findIndex(item=>item.type==='title'&&item.name===page);
  const next=definitions.findIndex((item,index)=>index>start&&item.type==='title');
  const items=definitions.slice(start+1,next<0?undefined:next);
  return <aside role="dialog" aria-label={t('setting.title')} className={mobile
    ? 'fixed bottom-0 left-0 w-full h-3/4 bg-gray-100/95 dark:bg-gray-900/95 theme-card-style shadow-lg z-50 p-4 overflow-y-auto'
    : 'h-dvh w-(--setting-width) bg-gray-100/95 dark:bg-gray-900/95 theme-card-style shadow-lg p-4 overflow-y-auto shrink-0'}
    onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();close();}}}>
    <div className="flex items-center justify-between mb-3"><h2 className="text-xl font-bold">{t('setting.title')}</h2>
      <Button onClick={close} variant="ghost" disabled={saving}>{t('setting.close')}</Button></div>
    <p className="text-xs text-secondary-foreground mb-3" role="status">{dirty?'有未保存的修改；取消或关闭会恢复原设置。':'修改后可实时预览，保存后对站点生效。'}</p>
    <div className="flex flex-wrap gap-2 mb-4">
      <Button asChild disabled={saving}><label>{t('setting.import')}<input type="file" accept=".json,application/json" className="hidden" onChange={importDraft} disabled={saving}/></label></Button>
      <Button onClick={exportDraft}>{t('setting.export')}</Button>
      <Button onClick={()=>setPreview(value=>!value)} aria-pressed={preview}>{preview?'实时预览：开':'实时预览：关'}</Button>
      <Button onClick={()=>toast(t('setting.resetConfirm'),{action:{label:t('setting.resetConfirmAction'),onClick:()=>setDraft({...DEFAULT_CONFIG})}})} disabled={saving}>{t('setting.reset')}</Button>
      <Button onClick={close} disabled={saving}>取消</Button>
      <Button onClick={()=>void save()} disabled={!dirty||saving} className="bg-green-600 text-white">{saving?'保存中…':t('setting.save')}</Button>
    </div>
    <nav className="flex items-center gap-2 mb-4 text-sm" aria-label="设置分类">
      {page!=='main'&&<Button size="icon" variant="ghost" aria-label="返回设置分类" onClick={()=>textPage!=='main'?setTextPage('main'):setPage('main')}><ArrowLeft/></Button>}
      <button type="button" onClick={()=>{setPage('main');setTextPage('main');}}>{t('setting.home')}</button>
      {page!=='main'&&<><span>/</span><span>{page}</span></>}
      {textPage!=='main'&&<span>/ {String((defaultTexts[textPage as keyof typeof defaultTexts] as {_:string})?._||textPage)}</span>}
    </nav>
    <fieldset disabled={saving} className="space-y-4 min-w-0">{page==='main'
      ? definitions.filter(item=>item.type==='title').map(item=><Button key={item.name} className="w-full justify-start" onClick={()=>setPage(item.name)}>{item.name}</Button>)
      : items.map(item=>'key'in item&&item.key==='customTexts'
        ? <CustomTextsEditor key={item.key} value={draft.customTexts||''} onChange={value=>change('customTexts',value)} page={textPage} onPageChange={setTextPage}/>
        : <SettingItem key={'key'in item?item.key:item.name} item={item} editingConfig={draft} onConfigChange={change}/>)}</fieldset>
  </aside>;
}
