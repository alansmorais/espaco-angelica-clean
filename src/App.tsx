/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';

import {
  Service,
  Appointment,
  ClientProfile,
  TimeSlotConfig,
  DayScheduleConfig,
  BlacklistEntry,
  StudioAddressConfig,
  WhatsAppConfig,
  PaymentConfig
} from './types';
import { sendAppointmentWhatsAppConfirmation } from './services/whatsappService';
import { playDiscreteAdminNotificationSound, registerUserInteraction } from './services/soundNotificationService';
import { calculateDeposit40, formatBRL } from './services/notificationTemplates';
import {
  deleteRemoteAppointment,
  updateRemoteAppointment,
  fetchRemoteAppointments,
  fetchRemoteAppointmentsDetailed,
  fetchPublicAvailability,
  submitBlockSchedule,
  fetchRemoteBlockedDates,
  fetchRemoteServices,
  saveRemoteService,
  deleteRemoteService,
  createAdminSession,
  revokeAdminSession,
  fetchRemoteScheduleConfig,
  saveRemoteWeeklySchedule,
  fetchRemoteAppSettings,
  saveRemoteAppSetting,
  fetchRemoteClients,
  saveRemoteClient,
  fetchPublicStudioAddress,
  fetchPublicPaymentConfig,
  saveRemoteScheduleBlock,
  deleteRemoteScheduleBlock
} from './services/emailNotificationService';

// Public Components
import { HeaderPublic } from './components/HeaderPublic';
import { HeroSection } from './components/HeroSection';
import { ServiceCatalog } from './components/ServiceCatalog';
import { BookingWizard } from './components/BookingWizard';
import { GallerySection } from './components/GallerySection';
import { LocationSection } from './components/LocationSection';
import { FooterPublic } from './components/FooterPublic';
import { AboutModal } from './components/Modals/AboutModal';
import { FAQModal } from './components/Modals/FAQModal';

// Admin Components
import { AdminSidebar, AdminTab } from './components/Admin/AdminSidebar';
import { AdminHeader } from './components/Admin/AdminHeader';
import { OverviewTab } from './components/Admin/OverviewTab';
import { CalendarTab } from './components/Admin/CalendarTab';
import { PixReconciliationTab } from './components/Admin/PixReconciliationTab';
import { ClientsTab } from './components/Admin/ClientsTab';
import { FinancialTab } from './components/Admin/FinancialTab';
import { SettingsTab } from './components/Admin/SettingsTab';

// Modals
import { ManualBookingModal } from './components/Modals/ManualBookingModal';
import { BlockScheduleModal, BlockScheduleData } from './components/Modals/BlockScheduleModal';
import { ExtraEncaixeModal } from './components/Modals/ExtraEncaixeModal';
import { NewClientModal } from './components/Modals/NewClientModal';

const READ_ONLY_PREVIEW = true;

export default function App() {
  // The isolated preview must never write to the official spreadsheet or expose admin controls.
  // Enable mutations only after Apps Script and payment flows are validated and approved.
  // Mode: 'public' (Client) vs 'admin' (Executive Atelier)
  const [appMode, setAppMode] = useState<'public' | 'admin'>('public');

  // Admin Login Modal & Session State (volatile, never stored permanently or in bundle)
  const [adminLoginModalOpen, setAdminLoginModalOpen] = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [adminLoginError, setAdminLoginError] = useState<string | null>(null);
  const [isVerifyingAdminLogin, setIsVerifyingAdminLogin] = useState(false);
  const [adminSessionToken, setAdminSessionToken] = useState<string>(() => {
    try {
      return sessionStorage.getItem('angelica_admin_session') || '';
    } catch {
      return '';
    }
  });

  const [isLoadingRemoteAppointments, setIsLoadingRemoteAppointments] = useState(false);
  const [remoteAppointmentsError, setRemoteAppointmentsError] = useState<string | null>(null);
  const [localOnlyCount, setLocalOnlyCount] = useState<number>(0);

  const calculateLocalOnlyCount = (remoteList: Appointment[]) => {
    try {
      const raw = localStorage.getItem('angelica_appointments_local_archive') || localStorage.getItem('angelica_appointments');
      if (!raw) {
        setLocalOnlyCount(0);
        return;
      }
      const localList: Appointment[] = JSON.parse(raw);
      const remoteIds = new Set(remoteList.map(a => a.id));
      const localOnly = localList.filter(a => !remoteIds.has(a.id));
      setLocalOnlyCount(localOnly.length);
      if (localOnly.length > 0) {
        localStorage.setItem('angelica_appointments_local_archive', JSON.stringify(localOnly));
      } else {
        localStorage.removeItem('angelica_appointments_local_archive');
      }
    } catch {
      setLocalOnlyCount(0);
    }
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (READ_ONLY_PREVIEW) {
      setAdminLoginError('O painel administrativo está desativado na pré-visualização. Nenhuma alteração será feita na planilha oficial.');
      return;
    }
    const entered = adminPasswordInput.trim();
    if (!entered) return;

    setIsVerifyingAdminLogin(true);
    setAdminLoginError(null);

    try {
      const session = await createAdminSession(entered);
      if (!session.success || !session.token) {
        setAdminLoginError(session.error || 'Não foi possível criar uma sessão administrativa segura.');
        return;
      }
      const result = await fetchRemoteAppointmentsDetailed(session.token);
      if (result.success) {
        setAdminSessionToken(session.token);
        try {
          sessionStorage.setItem('angelica_admin_session', session.token);
        } catch {}
        setAppointments(result.appointments);
        setRemoteAppointmentsError(null);
        setAdminLoginModalOpen(false);
        setAdminPasswordInput('');
        setAppMode('admin');
        calculateLocalOnlyCount(result.appointments);
      } else if (result.statusCode === 401) {
        setAdminLoginError('Senha administrativa incorreta ou não configurada no servidor. Acesso não autorizado.');
      } else {
        setAdminLoginError(
          result.error || 'Falha de comunicação ao verificar credencial com o servidor administrativo. Acesso negado.'
        );
      }
    } catch (err: any) {
      setAdminLoginError('Erro de conexão ao verificar credencial administrativa.');
    } finally {
      setIsVerifyingAdminLogin(false);
    }
  };

  const refreshRemoteAppointments = async () => {
    const token = adminSessionToken || (typeof window !== 'undefined' ? sessionStorage.getItem('angelica_admin_session') || '' : '');
    if (!token) return;
    setIsLoadingRemoteAppointments(true);
    setRemoteAppointmentsError(null);
    try {
      const result = await fetchRemoteAppointmentsDetailed(token);
      if (result.success) {
        setAppointments(result.appointments);
        calculateLocalOnlyCount(result.appointments);
      } else {
        setRemoteAppointmentsError(result.error || 'Erro ao sincronizar com o servidor.');
      }
    } catch (err: any) {
      setRemoteAppointmentsError('Falha de rede ao sincronizar com a planilha do Google Sheets.');
    } finally {
      setIsLoadingRemoteAppointments(false);
    }
  };

  const handleAdminLogout = () => {
    const token = adminSessionToken;
    if (token) void revokeAdminSession(token);
    try {
      sessionStorage.removeItem('angelica_admin_session');
    } catch {}
    setAdminSessionToken('');
    setAppMode('public');
  };

  const handleExportLocalBackup = () => {
    try {
      const raw = localStorage.getItem('angelica_appointments_local_archive') || localStorage.getItem('angelica_appointments');
      if (!raw) return;
      const blob = new Blob([raw], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup_agendamentos_locais_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Erro ao exportar backup local:', err);
    }
  };

  // Admin Active Tab
  const [adminTab, setAdminTab] = useState<AdminTab>('visao-geral');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);
  const [adminSearch, setAdminSearch] = useState<string>('');

  // 1 & 2: Services State (Shared between Public Catalog & Admin Price/Photo Manager)
  const [services, setServices] = useState<Service[]>([]);

  const activeServices = services.filter(s => s.active !== false);
  const [publicAvailability, setPublicAvailability] = useState<Appointment[]>([]);
  const [publicBlockedDates, setPublicBlockedDates] = useState<string[]>([]);
  const [publicAvailabilityLoaded, setPublicAvailabilityLoaded] = useState(false);
  const [publicAvailabilityError, setPublicAvailabilityError] = useState<string | null>(null);
  const [selectedService, setSelectedService] = useState<Service>(
    activeServices[0] || services[0] || undefined
  );

  // 4: Operating Hours & Time Slots State (Add, Edit, Delete, Block)
  const [timeSlots, setTimeSlots] = useState<TimeSlotConfig[]>([]);
  // Empty, closed weekday structure is UI scaffolding only; actual opening hours come from Sheets.
  const [daySchedules, setDaySchedules] = useState<DayScheduleConfig[]>([
    { dayKey: 'seg', dayLabel: 'Segunda-feira', isOpen: false, openTime: '', closeTime: '' },
    { dayKey: 'ter', dayLabel: 'Terça-feira', isOpen: false, openTime: '', closeTime: '' },
    { dayKey: 'qua', dayLabel: 'Quarta-feira', isOpen: false, openTime: '', closeTime: '' },
    { dayKey: 'qui', dayLabel: 'Quinta-feira', isOpen: false, openTime: '', closeTime: '' },
    { dayKey: 'sex', dayLabel: 'Sexta-feira', isOpen: false, openTime: '', closeTime: '' },
    { dayKey: 'sab', dayLabel: 'Sábado', isOpen: false, openTime: '', closeTime: '' },
    { dayKey: 'dom', dayLabel: 'Domingo', isOpen: false, openTime: '', closeTime: '' }
  ]);

  // 6: Inadimplentes Blacklist State (Requires 100% Pre-payment via Pix)
  const [blacklist, setBlacklist] = useState<BlacklistEntry[]>([]);

  // Studio address has no client-side fallback; it is loaded from the official Apps Script/Sheets settings.
  const [studioAddress, setStudioAddress] = useState<StudioAddressConfig>({ street: '', number: '', neighborhood: '', city: '', state: '', fullAddress: '', mapsUrl: '', wazeUrl: '' });
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig>({ pixKey: '', pixBeneficiary: '', depositAmount: 40 });
  const [paymentConfigLoaded, setPaymentConfigLoaded] = useState(false);
  const [paymentConfigConfigured, setPaymentConfigConfigured] = useState(false);

  // Appointments & Clients State (Real data only, default empty)
  const [appointments, setAppointments] = useState<Appointment[]>(() => {
    try {
      return [];
    } catch {
      return [];
    }
  });

  const [clients, setClients] = useState<ClientProfile[]>([]);

  useEffect(() => {
    if (appMode !== 'admin') return;
    let active = true;
    void fetchRemoteScheduleConfig(adminSessionToken).then(result => {
      if (!active || !result.success || !result.weeklySchedule) return;
      const weekly = result.weeklySchedule;
      const dayMap: Record<string, string> = { seg: 'monday', ter: 'tuesday', qua: 'wednesday', qui: 'thursday', sex: 'friday', sab: 'saturday', dom: 'sunday' };
      setDaySchedules(current => current.map(day => {
        const saved = weekly[dayMap[day.dayKey]];
        return saved && typeof saved === 'object' ? { ...day, isOpen: saved.open === true, openTime: String(saved.openTime || day.openTime), closeTime: String(saved.closeTime || day.closeTime) } : day;
      }));
      if (Array.isArray(weekly.slots)) setTimeSlots(weekly.slots.filter((slot: any) => slot && typeof slot.id === 'string' && typeof slot.time === 'string'));
    }).catch(error => console.error('[Schedule config] Read failed:', error));
    return () => { active = false; };
  }, [appMode]);

  useEffect(() => {
    let active = true;
    void fetchPublicPaymentConfig().then(result => {
      if (!active) return;
      if (result.success && result.paymentConfig) {
        setPaymentConfig(result.paymentConfig);
        setPaymentConfigConfigured(result.configured);
      } else {
        setPaymentConfigConfigured(false);
      }
      setPaymentConfigLoaded(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void fetchPublicStudioAddress().then(result => {
      if (active && result.success && result.address) setStudioAddress(result.address);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (appMode !== 'admin' || !adminSessionToken) return;
    let active = true;
    const syncClients = async () => {
      const result = await fetchRemoteClients(adminSessionToken);
      if (active && result.success) setClients(result.clients);
      else if (active && !result.success) console.error('[Official clients] Read failed:', result.error);
    };
    void syncClients();
    const interval = setInterval(() => { void syncClients(); }, 30000);
    return () => { active = false; clearInterval(interval); };
  }, [appMode, adminSessionToken]);

  useEffect(() => {
    if (appMode !== 'admin' || !adminSessionToken) return;
    let active = true;
    void fetchRemoteAppSettings(adminSessionToken).then(result => {
      if (!active || !result.success || !result.settings) return;
      const settings = result.settings;
      if (Array.isArray(settings.BLACKLIST)) setBlacklist(settings.BLACKLIST as BlacklistEntry[]);
      if (settings.STUDIO_ADDRESS && typeof settings.STUDIO_ADDRESS === 'object') setStudioAddress(settings.STUDIO_ADDRESS as StudioAddressConfig);
      if (settings.WHATSAPP_CONFIG && typeof settings.WHATSAPP_CONFIG === 'object') setWhatsappConfig(settings.WHATSAPP_CONFIG as WhatsAppConfig);
    }).catch(error => console.error('[Official app settings] Read failed:', error));
    return () => { active = false; };
  }, [appMode, adminSessionToken]);

  const handleUpdateBlacklist = async (next: BlacklistEntry[]) => {
    if (READ_ONLY_PREVIEW) { window.alert('Alterações desativadas na pré-visualização.'); return; }
    const result = await saveRemoteAppSetting('BLACKLIST', next, adminSessionToken);
    if (!result.success) {
      window.alert('Não foi possível salvar a lista de bloqueio na planilha oficial. ' + (result.error || ''));
      return;
    }
    setBlacklist(next);
  };

  const handleUpdateStudioAddress = async (next: StudioAddressConfig): Promise<boolean> => {
    if (READ_ONLY_PREVIEW) { window.alert('Alterações desativadas na pré-visualização.'); return false; }
    const result = await saveRemoteAppSetting('STUDIO_ADDRESS', next, adminSessionToken);
    if (!result.success) {
      window.alert('Não foi possível salvar o endereço na planilha oficial. ' + (result.error || ''));
      return false;
    }
    setStudioAddress(next);
    return true;
  };

  const handleUpdatePaymentConfig = async (next: PaymentConfig): Promise<boolean> => {
    if (READ_ONLY_PREVIEW) { window.alert('Alterações desativadas na pré-visualização.'); return false; }
    if (!next.pixKey.trim() || !next.pixBeneficiary.trim()) {
      window.alert('Informe a chave Pix oficial e o nome do favorecido antes de salvar.');
      return false;
    }
    if (!Number.isFinite(next.depositAmount) || next.depositAmount <= 0 || next.depositAmount > 100) {
      window.alert('O percentual do sinal deve ser maior que 0 e menor ou igual a 100.');
      return false;
    }
    const result = await saveRemoteAppSetting('PAYMENT_CONFIG', next, adminSessionToken);
    if (!result.success) {
      window.alert('Não foi possível salvar as regras de Pix na planilha oficial. ' + (result.error || ''));
      return false;
    }
    setPaymentConfig(next);
    setPaymentConfigConfigured(Boolean(next.pixKey.trim() && next.pixBeneficiary.trim()));
    return true;
  };

  const handleUpdateWhatsappConfig = async (next: WhatsAppConfig): Promise<boolean> => {
    if (READ_ONLY_PREVIEW) { window.alert('Alterações desativadas na pré-visualização.'); return false; }
    const result = await saveRemoteAppSetting('WHATSAPP_CONFIG', next, adminSessionToken);
    if (!result.success) {
      window.alert('Não foi possível salvar as configurações do WhatsApp na planilha oficial. ' + (result.error || ''));
      return false;
    }
    setWhatsappConfig(next);
    return true;
  };

  const persistWeeklySchedule = async (nextDays: DayScheduleConfig[], nextSlots: TimeSlotConfig[]): Promise<boolean> => {
    if (READ_ONLY_PREVIEW) { window.alert('Alterações de agenda desativadas na pré-visualização.'); return false; }
    const dayMap: Record<string, string> = { seg: 'monday', ter: 'tuesday', qua: 'wednesday', qui: 'thursday', sex: 'friday', sab: 'saturday', dom: 'sunday' };
    const weeklySchedule: Record<string, unknown> = { slots: nextSlots.map(slot => ({ ...slot })) };
    nextDays.forEach(day => {
      const key = dayMap[day.dayKey];
      if (key) weeklySchedule[key] = { open: day.isOpen, openTime: day.openTime, closeTime: day.closeTime };
    });
    const result = await saveRemoteWeeklySchedule(weeklySchedule, adminSessionToken);
    if (!result.success) {
      window.alert('Não foi possível salvar a agenda na planilha oficial. Nenhuma alteração local foi aplicada. ' + (result.error || ''));
      return false;
    }
    return true;
  };

  const handleUpdateTimeSlots = async (nextSlots: TimeSlotConfig[]) => {
    if (await persistWeeklySchedule(daySchedules, nextSlots)) setTimeSlots(nextSlots);
  };

  const handleUpdateDaySchedules = async (nextDays: DayScheduleConfig[]) => {
    if (await persistWeeklySchedule(nextDays, timeSlots)) setDaySchedules(nextDays);
  };

  // Restore an existing server-issued session after refresh; expired sessions are rejected server-side.
  useEffect(() => {
    if (READ_ONLY_PREVIEW) return;
    const token = adminSessionToken;
    if (!token) return;
    let active = true;
    void fetchRemoteAppointmentsDetailed(token).then(result => {
      if (!active) return;
      if (result.success) {
        setAppointments(result.appointments);
        setRemoteAppointmentsError(null);
        setAppMode('admin');
        calculateLocalOnlyCount(result.appointments);
      } else {
        try { sessionStorage.removeItem('angelica_admin_session'); } catch {}
        setAdminSessionToken('');
        setAppMode('public');
      }
    }).catch(() => {
      if (!active) return;
      setRemoteAppointmentsError('Não foi possível validar a sessão administrativa.');
    });
    return () => { active = false; };
  // Intentionally run only once on page load to validate the stored session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Official service catalogue is always reloaded from Google Sheets; do not cache it as a source of truth.

  // Centralized synchronization with Google Apps Script / Google Sheets only.
  useEffect(() => {
    if (appMode !== 'admin') return;
    let isMounted = true;

    const syncRemote = async () => {
      const token = adminSessionToken || (typeof window !== 'undefined' ? sessionStorage.getItem('angelica_admin_session') || '' : '');
      if (!token) return;

      try {
        setIsLoadingRemoteAppointments(true);
        const result = await fetchRemoteAppointmentsDetailed(token);
        if (!isMounted) return;

        if (result.success) {
          setRemoteAppointmentsError(null);
          setAppointments(result.appointments);
          calculateLocalOnlyCount(result.appointments);
        } else if (result.statusCode === 401) {
          try {
            sessionStorage.removeItem('angelica_admin_session');
          } catch {}
          setAdminSessionToken('');
          setAppMode('public');
          setAdminLoginError('Sessão administrativa expirada ou não autorizada pelo servidor. Faça login novamente.');
        } else {
          setRemoteAppointmentsError(result.error || 'Falha ao sincronizar com Google Sheets.');
        }
      } catch (err: any) {
        if (isMounted) {
          setRemoteAppointmentsError('Falha ao conectar ao servidor para sincronização.');
        }
      } finally {
        if (isMounted) {
          setIsLoadingRemoteAppointments(false);
        }
      }
    };

    syncRemote();
    const interval = setInterval(syncRemote, 30000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [appMode, adminSessionToken]);

  // Public availability synchronization; expose only date/time/status and fail closed when unavailable.
  useEffect(() => {
    let isMounted = true;
    const syncAvailability = async () => {
      const result = await fetchPublicAvailability();
      if (!isMounted) return;
      if (result.success) {
        setPublicAvailability(result.appointments);
        setPublicBlockedDates(result.blockedDates);
        if (result.weeklySchedule) {
          const weekly = result.weeklySchedule;
          const dayMap: Record<string, string> = { seg: 'monday', ter: 'tuesday', qua: 'wednesday', qui: 'thursday', sex: 'friday', sab: 'saturday', dom: 'sunday' };
          setDaySchedules(current => current.map(day => {
            const saved = weekly[dayMap[day.dayKey]];
            return saved && typeof saved === 'object'
              ? { ...day, isOpen: saved.open === true, openTime: String(saved.openTime || day.openTime), closeTime: String(saved.closeTime || day.closeTime) }
              : day;
          }));
          if (Array.isArray(weekly.slots)) {
            setTimeSlots(weekly.slots.filter((slot: any) => slot && typeof slot.id === 'string' && typeof slot.time === 'string'));
          }
        }
        setPublicAvailabilityLoaded(true);
        setPublicAvailabilityError(null);
      } else {
        setPublicAvailabilityLoaded(false);
        setPublicAvailabilityError(result.error || 'A disponibilidade oficial não está acessível.');
      }
    };
    void syncAvailability();
    const interval = setInterval(() => { void syncAvailability(); }, 30000);
    return () => { isMounted = false; clearInterval(interval); };
  }, []);

  // Public Blocked Dates Synchronization (Sem expor PII de clientes)
  useEffect(() => {
    let isMounted = true;
    const syncPublicBlockedDates = async () => {
      try {
        const blocked = await fetchRemoteBlockedDates();
        if (!isMounted || !Array.isArray(blocked)) return;
        const blockedDateKeys = new Set(blocked.map(String));
        setAppointments(prev => {
          // Remove stale display-only blocks when the authoritative backend says a date is unblocked.
          const withoutStaleRemoteBlocks = prev.filter(a =>
            !a.id.startsWith('apt-block-remote-') || blockedDateKeys.has(String(a.date))
          );
          const newBlocks: Appointment[] = blocked.map(bDate => ({
            id: `apt-block-remote-${String(bDate).replace(/[^a-zA-Z0-9]/g, '')}`,
            clientName: 'Dia Bloqueado',
            clientPhone: '',
            date: String(bDate),
            time: 'Dia Inteiro',
            serviceTitle: 'Bloqueio de Agenda',
            servicePrice: 'R$ 0,00',
            serviceDuration: 'Dia Inteiro',
            status: 'bloqueado' as const,
            paymentMode: 'sinal_40' as const,
            depositAmount: 0,
            depositStatus: 'liquidado' as const
          }));
          const existingIds = new Set(withoutStaleRemoteBlocks.map(a => a.id));
          const existingDates = new Set(withoutStaleRemoteBlocks.filter(a => a.status === 'bloqueado').map(a => String(a.date)));
          const toAdd = newBlocks.filter(b => !existingIds.has(b.id) && !existingDates.has(String(b.date)));
          return toAdd.length > 0 ? [...toAdd, ...withoutStaleRemoteBlocks] : withoutStaleRemoteBlocks;
        });
      } catch {}
    };

    syncPublicBlockedDates();
    const interval = setInterval(syncPublicBlockedDates, 60000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // Sincronização inicial de serviços remotos
  useEffect(() => {
    let isMounted = true;
    const syncServices = async () => {
      try {
        const remoteServices = await fetchRemoteServices();
        if (!isMounted) return;
        setServices(remoteServices);
        if (remoteServices.length > 0) {
          setSelectedService(current => remoteServices.find(service => service.id === current?.id) || remoteServices[0]);
        }
      } catch (error) {
        if (isMounted) {
          setServices([]);
          setPublicAvailabilityError(error instanceof Error ? error.message : 'Não foi possível carregar o catálogo oficial.');
        }
        console.error('[Official service catalogue] Read failed:', error);
      }
    };
    syncServices();
  }, []);

  // WhatsApp Business API Config State
  const [whatsappConfig, setWhatsappConfig] = useState<WhatsAppConfig>({ autoSendOnConfirm: false });

  const [waGlobalToast, setWaGlobalToast] = useState<{
    message: string;
    clientName: string;
    clientPhone: string;
    success: boolean;
    fallbackUrl?: string;
  } | null>(null);

  // Admin Real-time Pre-Booking Notification Toast State
  const [adminNewBookingToast, setAdminNewBookingToast] = useState<{
    id: string;
    clientName: string;
    serviceTitle: string;
    date: string;
    time: string;
    depositAmount: number;
  } | null>(null);

  // Set of appointment IDs already notified to avoid repeating alerts
  const seenNotificationIdsRef = React.useRef<Set<string>>(new Set());

  // On mount: mark existing appointments as already seen so we never trigger alerts for historical data
  useEffect(() => {
    appointments.forEach(a => seenNotificationIdsRef.current.add(a.id));
  }, []);

  // Helper to trigger alert when a new pre-booking arrives
  const notifyNewPreBooking = (apt: Appointment) => {
    if (seenNotificationIdsRef.current.has(apt.id)) return;
    seenNotificationIdsRef.current.add(apt.id);

    setAdminNewBookingToast({
      id: apt.id,
      clientName: apt.clientName,
      serviceTitle: apt.serviceTitle,
      date: apt.date,
      time: apt.time,
      depositAmount: apt.depositAmount
    });

    playDiscreteAdminNotificationSound();
  };

  // Real-time synchronization across browser tabs via storage event
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'angelica_appointments' && e.newValue) {
        try {
          const updatedList: Appointment[] = JSON.parse(e.newValue);
          const newPending = updatedList.filter(
            a => a.status === 'pendente_pix' && !seenNotificationIdsRef.current.has(a.id)
          );

          setAppointments(updatedList);

          if (newPending.length > 0) {
            notifyNewPreBooking(newPending[0]);
          }
        } catch {}
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Register user interaction to unlock Web Audio API seamlessly
  useEffect(() => {
    const handleInteraction = () => {
      registerUserInteraction();
    };
    window.addEventListener('click', handleInteraction, { once: true });
    window.addEventListener('touchstart', handleInteraction, { once: true });
    return () => {
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('touchstart', handleInteraction);
    };
  }, []);

  // Modals state
  const [aboutModalOpen, setAboutModalOpen] = useState<boolean>(false);
  const [faqModalOpen, setFaqModalOpen] = useState<boolean>(false);
  const [manualBookingModalOpen, setManualBookingModalOpen] = useState<boolean>(false);
  const [blockModalOpen, setBlockModalOpen] = useState<boolean>(false);
  const [blockModalInitialDate, setBlockModalInitialDate] = useState<string | undefined>(undefined);
  const [encaixeModalOpen, setEncaixeModalOpen] = useState<boolean>(false);
  const [newClientModalOpen, setNewClientModalOpen] = useState<boolean>(false);

  // Disable service writes during the isolated read-only preview.
  const handleUpdateService = async (updated: Service) => {
    if (READ_ONLY_PREVIEW) throw new Error('Edição de serviços desativada na pré-visualização.');
    const res = await saveRemoteService(updated, adminSessionToken);
    if (!res.success) throw new Error(res.error || 'Falha ao atualizar procedimento na planilha oficial.');
    const finalService = res.service || updated;
    setServices(prev => prev.map(s => (s.id === finalService.id ? finalService : s)));
    if (selectedService?.id === finalService.id) setSelectedService(finalService);
  };

  const handleAddService = async (newService: Service) => {
    if (READ_ONLY_PREVIEW) throw new Error('Criação de serviços desativada na pré-visualização.');
    const res = await saveRemoteService(newService, adminSessionToken);
    if (!res.success) throw new Error(res.error || 'Falha ao salvar serviço na planilha oficial.');
    const finalService = res.service || newService;
    setServices(prev => [finalService, ...prev.filter(s => s.id !== finalService.id)]);
  };

  const handleDeleteService = async (id: string) => {
    if (READ_ONLY_PREVIEW) throw new Error('Alteração de serviços desativada na pré-visualização.');
    const res = await deleteRemoteService(id, adminSessionToken);
    if (!res.success) throw new Error(res.error || 'Falha ao desativar serviço na planilha oficial.');
    setServices(prev => {
      const remaining = prev.filter(s => s.id !== id);
      if (selectedService?.id === id && remaining.length > 0) setSelectedService(remaining[0]);
      return remaining;
    });
  };

  // Handlers for client booking
  const handleSelectService = (service: Service) => {
    setSelectedService(service);
    const el = document.getElementById('wizard-agendamento');
    el?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleBookingConfirmed = (newApt: Appointment) => {
    if (READ_ONLY_PREVIEW) return;
    setAppointments(prev => [newApt, ...prev]);
    notifyNewPreBooking(newApt);


  };

  const handleUpdateAppointment = async (updated: Appointment) => {
    if (READ_ONLY_PREVIEW) throw new Error('Alterações de agendamentos estão desativadas na pré-visualização.');
    // Persist to backend / Google Sheets official storage
    const result = await updateRemoteAppointment(updated, adminSessionToken);
    if (!result.success || !result.persisted) {
      throw new Error(result.error || 'Falha ao atualizar o agendamento no servidor.');
    }

    const prevApt = appointments.find(a => a.id === updated.id);
    const isNowConfirmed = updated.status === 'confirmado' && (!prevApt || prevApt.status !== 'confirmado');
    const finalized = result.appointment ? { ...updated, ...result.appointment } : updated;

    setAppointments(prev => prev.map(a => (a.id === updated.id ? finalized : a)));

    // Sincroniza armazenamento local
    for (const storageKey of ['angelica_appointments', 'angelica_appointments_local_archive']) {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const list: Appointment[] = JSON.parse(raw);
          const updatedList = list.map(a => (a.id === updated.id ? finalized : a));
          localStorage.setItem(storageKey, JSON.stringify(updatedList));
        }
      } catch {}
    }

    // If appointment became confirmed and auto-send is enabled
    if (isNowConfirmed && whatsappConfig.autoSendOnConfirm && updated.whatsappStatus !== 'enviado') {
      try {
        const res = await sendAppointmentWhatsAppConfirmation(
          updated,
          whatsappConfig.customTemplate,
          studioAddress.fullAddress
        );
        const withWa: Appointment = {
          ...updated,
          whatsappStatus: res.status === 'sent' ? 'enviado' : res.status === 'simulated' ? 'simulado' : 'falha',
          whatsappSentAt: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          whatsappLastMessage: res.previewText || res.message
        };
        setAppointments(prev => prev.map(a => (a.id === updated.id ? withWa : a)));
        setWaGlobalToast({
          message: res.message,
          clientName: updated.clientName,
          clientPhone: updated.clientPhone,
          success: res.status === 'sent',
          fallbackUrl: res.fallbackUrl
        });
        setTimeout(() => setWaGlobalToast(null), 6000);
      } catch {}
    }
  };

  const handleDeleteAppointment = async (appointment: Appointment) => {
    if (READ_ONLY_PREVIEW) throw new Error('Exclusão de agendamentos desativada na pré-visualização.');
    const result = await deleteRemoteAppointment(appointment.id, adminSessionToken);
    if (!result.success) {
      throw new Error(result.error || 'Não foi possível excluir o agendamento.');
    }

    setAppointments(prev => prev.filter(a => a.id !== appointment.id));
    let archiveCount: number | null = null;
    for (const storageKey of ['angelica_appointments', 'angelica_appointments_local_archive']) {
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) continue;

        const storedAppointments: Appointment[] = JSON.parse(raw);
        const remaining = storedAppointments.filter(a => a.id !== appointment.id);
        if (remaining.length > 0) {
          localStorage.setItem(storageKey, JSON.stringify(remaining));
        } else {
          localStorage.removeItem(storageKey);
        }
        if (storageKey === 'angelica_appointments_local_archive') {
          archiveCount = remaining.length;
        }
      } catch (err) {
        console.error(`Não foi possível atualizar ${storageKey} após excluir o agendamento:`, err);
      }
    }
    if (archiveCount !== null) setLocalOnlyCount(archiveCount);
  };

  const handleUpdateClient = async (updated: ClientProfile) => {
    if (READ_ONLY_PREVIEW) { window.alert('Alterações de clientes desativadas na pré-visualização.'); return; }
    const result = await saveRemoteClient(updated, adminSessionToken);
    if (!result.success) {
      window.alert('Não foi possível salvar o perfil da cliente na planilha oficial. ' + (result.error || ''));
      return;
    }
    setClients(prev => prev.map(c => (c.id === updated.id || c.phone.replace(/\D/g, '') === updated.phone.replace(/\D/g, '') ? updated : c)));
  };

  const handleManualBookingSave = async (newApt: Appointment) => {
    if (READ_ONLY_PREVIEW) { window.alert('Agendamentos manuais desativados na pré-visualização.'); return; }
    // 1. Atualiza lista local imediatamente evitando duplicações
    setAppointments(prev => {
      const exists = prev.some(a => a.id === newApt.id);
      return exists ? prev.map(a => (a.id === newApt.id ? newApt : a)) : [newApt, ...prev];
    });

    // Client profiles are read from the official Clientes sheet after the booking is saved.

    // 3. Re-sincroniza imediatamente com a planilha oficial do Google Sheets (fonte da verdade)
    await refreshRemoteAppointments();
    const clientsResult = await fetchRemoteClients(adminSessionToken);
    if (clientsResult.success) setClients(clientsResult.clients);

    if (newApt.whatsappStatus === 'enviado' || newApt.whatsappStatus === 'simulado') {
      setWaGlobalToast({
        message: `Confirmação de agendamento disparada via WhatsApp para ${newApt.clientName} (${newApt.clientPhone})!`,
        clientName: newApt.clientName,
        clientPhone: newApt.clientPhone,
        success: true
      });
      setTimeout(() => setWaGlobalToast(null), 6000);
    }
  };

  const handleNewClientSave = async (newClient: ClientProfile) => {
    const result = await saveRemoteClient(newClient, adminSessionToken);
    if (!result.success) {
      window.alert('Não foi possível cadastrar a cliente na planilha oficial. ' + (result.error || ''));
      return;
    }
    setClients(prev => [newClient, ...prev.filter(client => client.id !== newClient.id && client.phone.replace(/\D/g, '') !== newClient.phone.replace(/\D/g, ''))]);
  };

  const handleBlockConfirm = async (data: BlockScheduleData): Promise<{ success: boolean; error?: string }> => {
    const isAllDay = data.timeSpan === 'Dia Inteiro';
    const blockApt: Appointment = {
      id: `apt-block-${Date.now()}`,
      clientName: isAllDay ? 'Dia Bloqueado (Folga)' : 'Horário Bloqueado',
      clientPhone: '',
      serviceTitle: isAllDay ? 'Bloqueio de Agenda (Dia Inteiro)' : `Bloqueio: ${data.reason}`,
      servicePrice: 'R$ 0,00',
      serviceDuration: data.timeSpan,
      date: data.date,
      time: isAllDay ? 'Dia Inteiro' : data.timeSpan,
      status: 'bloqueado',
      paymentMode: 'sinal_40',
      depositAmount: 0,
      depositStatus: 'liquidado',
      notes: data.notes || (isAllDay ? 'Dia inteiro bloqueado pela administração' : `Bloqueado: ${data.reason}`),
      blockReason: data.reason
    };

    const dmy = String(data.date).match(/^(\d{2})[./-](\d{2})[./-](\d{4})$/);
    const normalizedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(data.date))
      ? String(data.date)
      : dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : String(data.date);
    const intervalMatch = String(data.timeSpan).match(/(\d{1,2}:\d{2})\s*(?:às|as|-)\s*(\d{1,2}:\d{2})/i);
    const scheduleBlock = { id: blockApt.id, date: normalizedDate, allDay: isAllDay, startTime: intervalMatch?.[1], endTime: intervalMatch?.[2], reason: data.reason, active: true };
    const savedScheduleBlock = await saveRemoteScheduleBlock(scheduleBlock, adminSessionToken);
    if (!savedScheduleBlock.success) return { success: false, error: savedScheduleBlock.error || 'Não foi possível persistir o bloqueio na configuração da agenda.' };

    // Preserve the existing appointment block for the calendar and legacy conflict checks.
    const result = await submitBlockSchedule(blockApt, adminSessionToken);
    if (!result.success || !result.persisted) {
      await deleteRemoteScheduleBlock(scheduleBlock.id, adminSessionToken);
      return { success: false, error: result.error || 'O servidor não confirmou a gravação do bloqueio no armazenamento oficial.' };
    }
    if (!result.success || !result.persisted) {
      return {
        success: false,
        error: result.error || 'O servidor não confirmou a gravação do bloqueio no armazenamento oficial.'
      };
    }

    // 1. Atualiza lista local imediatamente
    setAppointments(prev => [blockApt, ...prev.filter(a => a.id !== blockApt.id)]);

    // 2. Se for horário específico, marca na grade
    const timeMatch = data.timeSpan.split(' ')[0];
    if (timeMatch && !isAllDay) {
      setTimeSlots(prev =>
        prev.map(s =>
          s.time.startsWith(timeMatch)
            ? { ...s, status: 'bloqueado', note: data.reason }
            : s
        )
      );
    }

    // 3. Re-sincroniza com a planilha oficial do Google Sheets (fonte da verdade)
    await refreshRemoteAppointments();

    return { success: true };
  };

  const handleExtraEncaixeConfirm = (name: string, procedure: string, dateTime: string, feeApplied: boolean) => {
    const encaixePrice = feeApplied ? 265 : 220;
    const encaixeApt: Appointment = {
      id: `encaixe-${Date.now()}`,
      clientName: name,
      clientPhone: '',
      serviceTitle: `${procedure} ${feeApplied ? '(+ Taxa Urgência)' : ''}`,
      servicePrice: feeApplied ? 'R$ 265,00' : 'R$ 220,00',
      serviceDuration: '1h 30min',
      date: dateTime.split('•')[0]?.trim() || 'Qua, 13 Nov',
      time: dateTime.split('•')[1]?.trim() || '20:15',
      status: 'pendente_pix',
      depositAmount: calculateDeposit40(encaixePrice),
      depositStatus: 'pendente',
      paymentMode: 'sinal_40',
      isVip: true,
      clientInitials: name
        .split(' ')
        .map(n => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    };
    setAppointments(prev => [encaixeApt, ...prev]);
  };

  const pendingPixCount = appointments.filter(
    a => a.status === 'pendente_pix' || a.depositStatus === 'pendente'
  ).length;

  return (
    <div className="min-h-screen bg-[#FBF7F2] text-[#49382E] font-jakarta antialiased selection:bg-[#E8D3C7] selection:text-[#49382E]">
      {/* ========================================================
          PUBLIC CLIENT EXPERIENCE
      ======================================================== */}
      {appMode === 'public' && (
        <div className="w-full min-h-screen bg-[#FBF7F2] flex flex-col pb-20 sm:pb-12">
          {/* Public Header */}
          <HeaderPublic
            onOpenBooking={() => {
              const el = document.getElementById('wizard-agendamento');
              el?.scrollIntoView({ behavior: 'smooth' });
            }}
            onOpenAdmin={() => { if (!READ_ONLY_PREVIEW) setAdminLoginModalOpen(true); }}
            onOpenAbout={() => setAboutModalOpen(true)}
            onOpenFAQ={() => setFaqModalOpen(true)}
            onOpenGallery={() => {
              const el = document.getElementById('galeria-nailart');
              el?.scrollIntoView({ behavior: 'smooth' });
            }}
            onOpenServices={() => {
              const el = document.getElementById('catalogo-vitrine');
              el?.scrollIntoView({ behavior: 'smooth' });
            }}
          />

          {/* Main Public Content */}
          <main className="w-full pt-20 flex-1">
            {/* Hero Section with Official Gold Logo and Badges */}
            <HeroSection
              onStartBooking={() => {
                const el = document.getElementById('wizard-agendamento');
                el?.scrollIntoView({ behavior: 'smooth' });
              }}
              onViewServices={() => {
                const el = document.getElementById('catalogo-vitrine');
                el?.scrollIntoView({ behavior: 'smooth' });
              }}
            />

            {/* Vitrine de Procedimentos (Uses Dynamic Services) */}
            <ServiceCatalog
              services={services}
              onSelectService={handleSelectService}
              selectedServiceId={selectedService?.id}
            />

            {/* Public booking is unavailable until the real service catalogue loads; never show a mock service as bookable. */}
            {READ_ONLY_PREVIEW ? (
              <section id="wizard-agendamento" className="mx-auto my-12 max-w-3xl rounded-2xl border border-[#E8D9B5] bg-white p-8 text-center">
                <h2 className="font-syne text-xl font-bold text-[#49382E]">Pré-visualização segura</h2>
                <p className="mt-2 text-sm text-[#786C63]">Os serviços e as configurações são consultados sem ativar gravações. O agendamento e o painel administrativo só serão ativados após validar o Apps Script e os pagamentos oficiais.</p>
              </section>
            ) : activeServices.length > 0 && publicAvailabilityLoaded && paymentConfigLoaded && paymentConfigConfigured ? (
              <BookingWizard
                selectedService={activeServices.find(s => s.id === selectedService?.id) || activeServices[0]}
                onBookingConfirmed={handleBookingConfirmed}
                timeSlots={timeSlots}
                blacklist={blacklist}
                studioAddress={studioAddress}
                paymentConfig={paymentConfig}
                services={activeServices}
                onSelectService={handleSelectService}
                appointments={publicAvailability}
                blockedDates={publicBlockedDates}
                daySchedules={daySchedules}
              />
            ) : (
              <section id="wizard-agendamento" className="mx-auto my-12 max-w-3xl rounded-2xl border border-[#E8D9B5] bg-white p-8 text-center">
                <h2 className="font-syne text-xl font-bold text-[#49382E]">Agenda temporariamente indisponível</h2>
                <p className="mt-2 text-sm text-[#786C63]">{!publicAvailabilityLoaded ? (publicAvailabilityError || 'Carregando a disponibilidade oficial da agenda…') : !paymentConfigLoaded ? 'Carregando a configuração oficial de pagamento…' : !paymentConfigConfigured ? 'Os dados oficiais de Pix ainda não foram cadastrados na planilha. O agendamento está temporariamente indisponível para evitar instruções de pagamento incorretas.' : 'Não foi possível carregar o catálogo oficial de serviços. Nenhum serviço de demonstração será exibido. Tente novamente em instantes ou entre em contato com o espaço.'}</p>
              </section>
            )}

            {/* Galeria de Criações Recentes */}
            <GallerySection />

            {/* Localização Nobre no Pontal da Cruz, São Sebastião SP */}
            <LocationSection studioAddress={studioAddress} />
          </main>

          {/* Public Footer */}
          <FooterPublic
            onOpenAbout={() => setAboutModalOpen(true)}
            onOpenFAQ={() => setFaqModalOpen(true)}
            onOpenAdmin={() => setAdminLoginModalOpen(true)}
          />

          {/* ONLY ONE Floating Action Button on Public Website: Centered "Agendar" */}
          <div className="fixed bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 z-40 pointer-events-auto">
            <button
              type="button"
              onClick={() => {
                const el = document.getElementById('wizard-agendamento');
                el?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="flex items-center gap-2 px-6 py-3 rounded-full bg-[#D4AF37] hover:bg-[#E5C158] text-[#3C2F00] font-jakarta font-bold text-xs sm:text-sm shadow-[0_10px_25px_-3px_rgba(212,175,55,0.45),0_4px_12px_rgba(73,56,46,0.15)] border border-[#E8D9B5] transition-all cursor-pointer transform active:scale-95 whitespace-nowrap min-h-[46px]"
              style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
              title="Agendar Horário no Ateliê"
            >
              <span className="material-symbols-outlined text-[19px]">calendar_month</span>
              <span>Agendar</span>
            </button>
          </div>

          {/* Admin Login Modal (Password Protected) */}
          {adminLoginModalOpen && (
            <div className="fixed inset-0 z-50 bg-[#49382E]/60 backdrop-blur-md flex items-center justify-center p-4">
              <div className="bg-[#FFFFFF] p-6 sm:p-8 rounded-3xl max-w-md w-full border border-[#E8D9B5] shadow-2xl relative text-center animate-fadeIn">
                <button
                  type="button"
                  onClick={() => {
                    setAdminLoginModalOpen(false);
                    setAdminPasswordInput('');
                    setAdminLoginError(null);
                  }}
                  className="absolute top-4 right-4 w-10 h-10 rounded-full bg-[#F7EFEA] border border-[#E8D9B5] flex items-center justify-center text-[#786C63] hover:text-[#49382E] cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[20px]">close</span>
                </button>

                <div className="w-16 h-16 rounded-2xl bg-[#FBF2D5] text-[#D4AF37] mx-auto flex items-center justify-center mb-4 border border-[#E8D9B5]">
                  <span className="material-symbols-outlined text-[32px]">admin_panel_settings</span>
                </div>

                <h3 className="font-syne text-xl sm:text-2xl text-[#49382E] font-bold">
                  Painel Administrativo
                </h3>
                <p className="font-jakarta text-xs text-[#786C63] mt-1 mb-6">
                  Acesso restrito à profissional responsável. Informe a senha de segurança para continuar.
                </p>

                <form onSubmit={handleAdminLogin} className="space-y-4 text-left font-jakarta text-xs">
                  <div>
                    <label className="block text-[#49382E] font-semibold mb-1">Senha de Acesso</label>
                    <input
                      type="password"
                      required
                      autoFocus
                      disabled={isVerifyingAdminLogin}
                      placeholder="Digite a senha..."
                      value={adminPasswordInput}
                      onChange={e => setAdminPasswordInput(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] outline-none focus:border-[#D4AF37] text-base sm:text-sm min-h-[44px] disabled:opacity-60"
                    />
                  </div>

                  {adminLoginError && (
                    <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-[11px] leading-relaxed">
                      {adminLoginError}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isVerifyingAdminLogin}
                    className="w-full py-3.5 rounded-full bg-[#D4AF37] hover:bg-[#E5C158] text-[#3C2F00] font-jakarta text-sm font-bold transition-all shadow-md cursor-pointer active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isVerifyingAdminLogin ? (
                      <>
                        <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>
                        <span>Verificando credencial...</span>
                      </>
                    ) : (
                      <span>Entrar no Painel do Ateliê</span>
                    )}
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================
          ADMIN MASTER ARTIST EXPERIENCE
      ======================================================== */}
      {!READ_ONLY_PREVIEW && appMode === 'admin' && (
        <div className="w-full min-h-screen bg-[#FBF7F2] text-[#49382E] flex">
          {/* Admin Sidebar */}
          <AdminSidebar
            activeTab={adminTab}
            onSelectTab={setAdminTab}
            onSwitchToPublic={handleAdminLogout}
            isOpenMobile={mobileSidebarOpen}
            onCloseMobile={() => setMobileSidebarOpen(false)}
            pendingPixCount={pendingPixCount}
          />

          {/* Admin Main Body Container */}
          <div className="flex-1 xl:pl-72 flex flex-col min-w-0 min-h-screen">
            {/* Admin Header */}
            <AdminHeader
              onOpenManualBooking={() => setManualBookingModalOpen(true)}
              onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
              onSwitchToPublic={handleAdminLogout}
              searchQuery={adminSearch}
              onSearchChange={setAdminSearch}
            />

            {/* Visual Notification Toast for New Pre-Booking */}
            {adminNewBookingToast && (
              <div className="fixed top-20 right-4 sm:right-6 z-50 max-w-md w-full bg-[#FFFFFF] border-2 border-[#D4AF37] shadow-2xl rounded-2xl p-4 flex items-start gap-3.5 animate-fadeIn">
                <div className="w-10 h-10 rounded-full bg-[#FBF2D5] text-[#D4AF37] flex items-center justify-center shrink-0 border border-[#E8D9B5]">
                  <span className="material-symbols-outlined text-[24px]">notifications_active</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="font-syne text-xs font-bold text-[#3C2F00] uppercase tracking-wider">
                      Novo Pré-Agendamento!
                    </span>
                    <button
                      type="button"
                      onClick={() => setAdminNewBookingToast(null)}
                      className="text-[#786C63] hover:text-[#49382E] text-xs cursor-pointer p-0.5"
                      title="Dispensar aviso"
                    >
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  </div>
                  <p className="font-jakarta text-xs text-[#49382E] font-bold">
                    {adminNewBookingToast.clientName}
                  </p>
                  <p className="font-jakarta text-[11px] text-[#786C63] mt-0.5">
                    {adminNewBookingToast.serviceTitle} • <strong>{adminNewBookingToast.date} às {adminNewBookingToast.time}</strong>
                  </p>
                  <div className="mt-2.5 flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full bg-[#F7EFEA] border border-[#E8D9B5] text-[10px] font-bold text-[#D4AF37]">
                      Sinal Pix: R$ {formatBRL(adminNewBookingToast.depositAmount)}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setAdminTab('confirmacao-sinais-pix');
                        setAdminNewBookingToast(null);
                      }}
                      className="text-[11px] font-bold text-[#D4AF37] hover:underline flex items-center gap-0.5 cursor-pointer ml-auto"
                    >
                      <span>Conferir no Extrato</span>
                      <span className="material-symbols-outlined text-[12px]">arrow_forward</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Admin Tab View Content */}
            <main className="flex-1 pt-24 px-4 sm:px-6 lg:px-8 pb-16">
              {/* Sync Status Banner */}
              <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 sm:p-4 rounded-2xl bg-white border border-[#E8D9B5] shadow-sm">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    remoteAppointmentsError
                      ? 'bg-amber-100 text-amber-700 border border-amber-300'
                      : isLoadingRemoteAppointments
                      ? 'bg-[#FBF2D5] text-[#D4AF37] border border-[#E8D9B5]'
                      : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  }`}>
                    <span className={`material-symbols-outlined text-[20px] ${isLoadingRemoteAppointments ? 'animate-spin' : ''}`}>
                      {remoteAppointmentsError ? 'cloud_off' : isLoadingRemoteAppointments ? 'sync' : 'cloud_done'}
                    </span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-syne text-xs font-bold text-[#49382E]">
                        {remoteAppointmentsError
                          ? 'Modo Offline (Contingência Local)'
                          : isLoadingRemoteAppointments
                          ? 'Sincronizando na Nuvem'
                          : 'Sincronizado na Nuvem'}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        remoteAppointmentsError
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}>
                        {appointments.length} {appointments.length === 1 ? 'agendamento' : 'agendamentos'}
                      </span>
                    </div>
                    {remoteAppointmentsError && (
                      <p className="font-jakarta text-[11px] text-[#786C63] mt-0.5">
                        Aviso: {remoteAppointmentsError}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center">
                  <button
                    type="button"
                    onClick={refreshRemoteAppointments}
                    disabled={isLoadingRemoteAppointments}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#F7EFEA] hover:bg-[#E8D9B5] text-[#49382E] font-jakarta text-xs font-semibold border border-[#E8D9B5] transition-all cursor-pointer disabled:opacity-50"
                    title="Atualizar dados do Google Sheets"
                  >
                    <span className={`material-symbols-outlined text-[16px] ${isLoadingRemoteAppointments ? 'animate-spin' : ''}`}>
                      refresh
                    </span>
                    <span>{isLoadingRemoteAppointments ? 'Sincronizando...' : 'Atualizar'}</span>
                  </button>
                </div>
              </div>

              {/* Local-only Unpersisted Appointments Warning Card */}
              {localOnlyCount > 0 && (
                <div className="mb-6 p-4 rounded-2xl bg-amber-50/90 border border-amber-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="material-symbols-outlined text-amber-600 text-[22px] shrink-0 mt-0.5">
                      history_edu
                    </span>
                    <div>
                      <h4 className="font-syne text-xs font-bold text-amber-900">
                        Histórico Local Detectado ({localOnlyCount} agendamento{localOnlyCount > 1 ? 's' : ''} local{localOnlyCount > 1 ? 'is' : ''})
                      </h4>
                      <p className="font-jakarta text-[11px] text-amber-800 mt-0.5">
                        Existem registros armazenados apenas no navegador deste dispositivo que não constam na planilha do Google Sheets. Para protegê-los contra perda acidental, você pode exportar o arquivo de backup.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleExportLocalBackup}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-jakarta text-xs font-semibold shadow-sm transition-all cursor-pointer shrink-0"
                    title="Exportar backup dos agendamentos locais em arquivo JSON"
                  >
                    <span className="material-symbols-outlined text-[16px]">download</span>
                    <span>Exportar Backup ({localOnlyCount})</span>
                  </button>
                </div>
              )}

              {adminTab === 'visao-geral' && (
                <OverviewTab
                  onOpenManualBooking={() => setManualBookingModalOpen(true)}
                  onNavigateToTab={setAdminTab}
                  onSelectAppointmentForReview={_name => {
                    setAdminTab('gestao-clientes');
                  }}
                  todayAppointments={appointments.filter(a => {
                    if (a.status === 'cancelado' || a.status === 'bloqueado') return false;
                    const value = String(a.date || '').trim();
                    const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
                    const br = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
                    const dateKey = iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : br ? `${br[3]}-${br[2]}-${br[1]}` : '';
                    const todayParts = new Intl.DateTimeFormat('en', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
                    const todayValues = Object.fromEntries(todayParts.map(part => [part.type, part.value]));
                    const todayKey = `${todayValues.year}-${todayValues.month}-${todayValues.day}`;
                    return dateKey === todayKey;
                  })}
                  allAppointments={appointments}
                />
              )}

              {adminTab === 'agenda-bloqueios' && (
                <CalendarTab
                  onOpenBlockModal={(date) => {
                    setBlockModalInitialDate(date);
                    setBlockModalOpen(true);
                  }}
                  onOpenExtraEncaixeModal={() => setEncaixeModalOpen(true)}
                  onSelectClientForDossier={_name => {
                    setAdminTab('gestao-clientes');
                  }}
                  appointments={appointments}
                  timeSlots={timeSlots}
                  services={services}
                  onUpdateAppointment={handleUpdateAppointment}
                  onDeleteAppointment={handleDeleteAppointment}
                />
              )}

              {adminTab === 'confirmacao-sinais-pix' && (
                <PixReconciliationTab
                  appointments={appointments}
                  onUpdateAppointment={handleUpdateAppointment}
                  onDeleteAppointment={handleDeleteAppointment}
                />
              )}

              {adminTab === 'gestao-clientes' && (
                <ClientsTab
                  clients={clients}
                  onOpenNewClientModal={() => setNewClientModalOpen(true)}
                  onBookNextForClient={_client => {
                    setManualBookingModalOpen(true);
                  }}
                  onUpdateClient={handleUpdateClient}
                />
              )}

              {adminTab === 'financeiro-servicos' && (
                <FinancialTab
                  services={services}
                  onUpdateService={handleUpdateService}
                  onAddService={handleAddService}
                  onDeleteService={handleDeleteService}
                  appointments={appointments}
                  adminSessionToken={adminSessionToken}
                />
              )}

              {adminTab === 'configuracoes' && (
                <SettingsTab
                   readOnlyPreview={READ_ONLY_PREVIEW}
                   adminSessionToken={adminSessionToken}
                  timeSlots={timeSlots}
                  onUpdateTimeSlots={handleUpdateTimeSlots}
                  daySchedules={daySchedules}
                  onUpdateDaySchedules={handleUpdateDaySchedules}
                  blacklist={blacklist}
                  onUpdateBlacklist={handleUpdateBlacklist}
                  studioAddress={studioAddress}
                  onUpdateStudioAddress={handleUpdateStudioAddress}
                  onUpdatePaymentConfig={handleUpdatePaymentConfig}
                  whatsappConfig={whatsappConfig}
                  onUpdateWhatsappConfig={handleUpdateWhatsappConfig}
                />
              )}
            </main>
          </div>
        </div>
      )}

      {/* Global Modals */}
      <AboutModal
        isOpen={aboutModalOpen}
        onClose={() => setAboutModalOpen(false)}
        onBookNow={() => {
          const el = document.getElementById('wizard-agendamento');
          el?.scrollIntoView({ behavior: 'smooth' });
        }}
      />

      <FAQModal
        isOpen={faqModalOpen}
        onClose={() => setFaqModalOpen(false)}
        onBookNow={() => {
          const el = document.getElementById('wizard-agendamento');
          el?.scrollIntoView({ behavior: 'smooth' });
        }}
      />

      <ManualBookingModal
        isOpen={manualBookingModalOpen}
        onClose={() => setManualBookingModalOpen(false)}
        onSaveAppointment={handleManualBookingSave}
        services={services}
        blacklist={blacklist}
        adminSessionToken={adminSessionToken}
        paymentConfig={paymentConfig}
      />

      <BlockScheduleModal
        isOpen={blockModalOpen}
        onClose={() => setBlockModalOpen(false)}
        onConfirmBlock={handleBlockConfirm}
        initialDate={blockModalInitialDate}
      />

      <ExtraEncaixeModal
        isOpen={encaixeModalOpen}
        onClose={() => setEncaixeModalOpen(false)}
        onConfirmEncaixe={handleExtraEncaixeConfirm}
      />

      <NewClientModal
        isOpen={newClientModalOpen}
        onClose={() => setNewClientModalOpen(false)}
        onSaveClient={handleNewClientSave}
      />

      {/* WhatsApp Business Confirmation Notification Toast */}
      {waGlobalToast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm w-full bg-[#FFFFFF] border border-[#E8D9B5] shadow-2xl rounded-2xl p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-[#25D366]/15 text-[#25D366] flex items-center justify-center shrink-0 border border-[#25D366]/30">
            <span className="material-symbols-outlined text-[20px]">
              {waGlobalToast.success ? 'mark_chat_read' : 'info'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-1 mb-0.5">
              <span className="font-syne text-xs font-bold text-[#49382E]">
                WhatsApp Business API
              </span>
              <button
                type="button"
                onClick={() => setWaGlobalToast(null)}
                className="text-[#786C63] hover:text-[#49382E] text-xs cursor-pointer"
              >
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            </div>
            <p className="font-jakarta text-[11px] text-[#786C63] leading-snug">
              {waGlobalToast.message}
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="text-[10px] font-bold text-[#D4AF37]">
                {waGlobalToast.clientName} ({waGlobalToast.clientPhone})
              </span>
              {waGlobalToast.fallbackUrl && (
                <a
                  href={waGlobalToast.fallbackUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-[#25D366] font-bold hover:underline inline-flex items-center gap-0.5"
                >
                  <span>Abrir conversa</span>
                  <span className="material-symbols-outlined text-[10px]">open_in_new</span>
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
