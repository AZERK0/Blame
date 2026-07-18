"use client";

import {
  CheckCircle2,
  Folder,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  advancedOptions,
  backendOptions,
  databaseOptions,
  defaultConfiguration,
  frontendOptions,
  generationStages,
  normalizeProjectConfiguration,
  optionLabel,
  ormOptions,
  packageManagerOptions,
  platformOptions,
  projectSteps,
  qualityOptions,
  recommendedBackend,
  recommendedUiLibrary,
  requiresTailwind,
  stylingOptions,
  uiLibraryOptions,
  type ConfigurationKey,
  type ProjectConfiguration,
  type ProjectOption,
} from "./project-creation-data";
import styles from "./project-creation-mockup.module.css";

const initialParentPath = "/Users/raphael/Projects";
const initialProjectName = "blame-starter";
const parentPathInputId = "project-creation-parent-path";
const projectNameInputId = "project-creation-name";

export function ProjectCreationMockup() {
  const wizard = useProjectCreationWizard();
  return (
    <div className={styles.root} aria-label="Interactive project creation demo">
      <WizardDialog wizard={wizard} />
    </div>
  );
}

function useProjectCreationWizard() {
  const navigation = useWizardNavigation();
  const generation = useFakeGeneration();
  const form = useProjectForm();
  const restart = () => {
    form.reset();
    generation.reset();
    navigation.restart();
  };
  return { ...form, generation, navigation, restart };
}

function useProjectForm() {
  const [configuration, setConfiguration] = useState(defaultConfiguration);
  const [parentPath, setParentPath] = useState(initialParentPath);
  const [projectName, setProjectName] = useState(initialProjectName);
  const update = (key: ConfigurationKey, value: string) => {
    setConfiguration((current) =>
      normalizeProjectConfiguration(updateConfiguration(current, key, value)),
    );
  };
  const toggleAdvanced = (value: string) => {
    setConfiguration((current) => toggleAdvancedOption(current, value));
  };
  const reset = () => {
    setConfiguration(defaultConfiguration);
    setParentPath(initialParentPath);
    setProjectName(initialProjectName);
  };
  return {
    configuration,
    parentPath,
    projectName,
    reset,
    setParentPath,
    setProjectName,
    toggleAdvanced,
    update,
  };
}

type WizardModel = ReturnType<typeof useProjectCreationWizard>;

function useWizardNavigation() {
  const [stepIndex, setStepIndex] = useState(2);
  const [highestVisited, setHighestVisited] = useState(2);
  const goTo = (index: number) => {
    if (index <= highestVisited) setStepIndex(index);
  };
  const next = () => {
    const nextIndex = Math.min(stepIndex + 1, projectSteps.length - 1);
    setStepIndex(nextIndex);
    setHighestVisited((current) => Math.max(current, nextIndex));
  };
  const back = () => setStepIndex((current) => Math.max(0, current - 1));
  const restart = () => {
    setStepIndex(0);
    setHighestVisited(0);
  };
  return { back, goTo, highestVisited, next, restart, stepIndex };
}

function useFakeGeneration() {
  const [stageIndex, setStageIndex] = useState<number | null>(null);
  const lastStage = generationStages.length - 1;
  useEffect(
    () => scheduleGenerationStage(stageIndex, setStageIndex),
    [stageIndex],
  );
  const start = () => setStageIndex(0);
  const reset = () => setStageIndex(null);
  return {
    finished: stageIndex === lastStage,
    logs: generationLogs(stageIndex),
    reset,
    running: stageIndex !== null && stageIndex < lastStage,
    stage: stageIndex === null ? null : generationStages[stageIndex],
    start,
  };
}

function scheduleGenerationStage(
  stageIndex: number | null,
  setStageIndex: (index: number) => void,
) {
  if (stageIndex === null || stageIndex >= generationStages.length - 1) return;
  const duration = reducedMotion()
    ? 180
    : generationStages[stageIndex].duration;
  const timer = window.setTimeout(
    () => setStageIndex(stageIndex + 1),
    duration,
  );
  return () => window.clearTimeout(timer);
}

function WizardDialog({ wizard }: { wizard: WizardModel }) {
  const generating = wizard.generation.stage !== null;
  return (
    <section className={styles.dialog} aria-label="New Project">
      <DialogHeader />
      {generating ? (
        <GenerationContent wizard={wizard} />
      ) : (
        <WizardContent wizard={wizard} />
      )}
      {generating ? (
        <GenerationFooter wizard={wizard} />
      ) : (
        <WizardFooter wizard={wizard} />
      )}
    </section>
  );
}

function DialogHeader() {
  return (
    <header className={styles.header}>
      <div>
        <h3 className={styles.title}>New Project</h3>
        <p className={styles.description}>
          Generate a codebase ready for Blame workflows.
        </p>
      </div>
      <span className={styles.closeButton} aria-hidden="true">
        <X aria-hidden="true" />
      </span>
    </header>
  );
}

function WizardContent({ wizard }: { wizard: WizardModel }) {
  return (
    <div className={styles.body}>
      <StepProgress navigation={wizard.navigation} />
      <StepContent wizard={wizard} />
    </div>
  );
}

function StepProgress({
  navigation,
}: {
  navigation: WizardModel["navigation"];
}) {
  return (
    <nav className={styles.stepper} aria-label="Project creation progress">
      {projectSteps.map((step, index) => (
        <button
          key={step.id}
          type="button"
          aria-label={step.label}
          aria-current={index === navigation.stepIndex ? "step" : undefined}
          className={styles.stepButton}
          data-active={index <= navigation.stepIndex}
          disabled={index > navigation.highestVisited}
          onClick={() => navigation.goTo(index)}
        />
      ))}
    </nav>
  );
}

function StepContent({ wizard }: { wizard: WizardModel }) {
  const step = projectSteps[wizard.navigation.stepIndex];
  return (
    <StepFrame title={step.title} description={step.description}>
      <SelectedStep id={step.id} wizard={wizard} />
    </StepFrame>
  );
}

function SelectedStep({ id, wizard }: { id: string; wizard: WizardModel }) {
  if (id === "location") return <LocationStep wizard={wizard} />;
  if (id === "platform") return <PlatformStep wizard={wizard} />;
  if (id === "frontend") return <FrontendStep wizard={wizard} />;
  if (id === "styling") return <StylingStep wizard={wizard} />;
  if (id === "backend") return <BackendStep wizard={wizard} />;
  if (id === "data") return <DataStep wizard={wizard} />;
  if (id === "quality") return <QualityStep wizard={wizard} />;
  if (id === "advanced") return <AdvancedStep wizard={wizard} />;
  return <SummaryStep wizard={wizard} />;
}

function StepFrame({
  children,
  description,
  title,
}: {
  children: React.ReactNode;
  description: string;
  title: string;
}) {
  return (
    <div className={styles.stepContent}>
      <div className={styles.stepHeading}>
        <h4 className={styles.stepTitle}>{title}</h4>
        <p className={styles.stepDescription}>{description}</p>
      </div>
      {children}
    </div>
  );
}

function LocationStep({ wizard }: { wizard: WizardModel }) {
  return (
    <div className={styles.locationPanel}>
      <ParentPathField wizard={wizard} />
      <ProjectNameField wizard={wizard} />
      <PathPreview
        parentPath={wizard.parentPath}
        projectName={wizard.projectName}
      />
    </div>
  );
}

function ParentPathField({ wizard }: { wizard: WizardModel }) {
  return (
    <TextField
      inputId={parentPathInputId}
      label="Parent folder"
      description="Pick the folder that will contain the generated project."
    >
      <div className={styles.inputRow}>
        <input
          id={parentPathInputId}
          aria-describedby={fieldDescriptionId(parentPathInputId)}
          value={wizard.parentPath}
          onChange={(event) => wizard.setParentPath(event.target.value)}
        />
        <button
          type="button"
          onClick={() => wizard.setParentPath(initialParentPath)}
        >
          <Folder aria-hidden="true" /> Browse
        </button>
      </div>
    </TextField>
  );
}

function ProjectNameField({ wizard }: { wizard: WizardModel }) {
  return (
    <TextField
      inputId={projectNameInputId}
      label="Project name"
      description="Use a short, readable folder name for the new codebase."
    >
      <input
        id={projectNameInputId}
        aria-describedby={fieldDescriptionId(projectNameInputId)}
        value={wizard.projectName}
        onChange={(event) => wizard.setProjectName(event.target.value)}
      />
    </TextField>
  );
}

function TextField({
  children,
  description,
  inputId,
  label,
}: {
  children: React.ReactNode;
  description: string;
  inputId: string;
  label: string;
}) {
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={inputId}>
        {label}
      </label>
      <span
        className={styles.fieldDescription}
        id={fieldDescriptionId(inputId)}
      >
        {description}
      </span>
      {children}
    </div>
  );
}

function fieldDescriptionId(inputId: string) {
  return `${inputId}-description`;
}

function PathPreview({
  parentPath,
  projectName,
}: {
  parentPath: string;
  projectName: string;
}) {
  return (
    <div className={styles.pathPreview}>
      <span>Project path</span>
      <code>
        {parentPath}/{projectName}
      </code>
    </div>
  );
}

function PlatformStep({ wizard }: { wizard: WizardModel }) {
  return (
    <OptionGrid
      options={platformOptions}
      value={wizard.configuration.platform}
      onChange={(value) => wizard.update("platform", value)}
    />
  );
}

function FrontendStep({ wizard }: { wizard: WizardModel }) {
  return (
    <OptionGrid
      options={frontendOptions}
      value={wizard.configuration.frontend}
      onChange={(value) => wizard.update("frontend", value)}
    />
  );
}

function StylingStep({ wizard }: { wizard: WizardModel }) {
  const options = stylingOptionsFor(wizard.configuration);
  return (
    <div className={styles.stack}>
      <OptionGrid
        options={options}
        value={wizard.configuration.styling}
        onChange={(value) => wizard.update("styling", value)}
      />
      <SelectField
        label="UI library"
        options={uiLibraryOptions(wizard.configuration.frontend)}
        value={wizard.configuration.uiLibrary}
        onChange={(value) => wizard.update("uiLibrary", value)}
      />
    </div>
  );
}

function BackendStep({ wizard }: { wizard: WizardModel }) {
  return (
    <OptionGrid
      options={backendOptions(wizard.configuration.frontend)}
      value={wizard.configuration.backend}
      onChange={(value) => wizard.update("backend", value)}
    />
  );
}

function DataStep({ wizard }: { wizard: WizardModel }) {
  const configuration = wizard.configuration;
  return (
    <div className={styles.stack}>
      <OptionGrid
        options={databaseOptions}
        value={configuration.database}
        onChange={(value) => wizard.update("database", value)}
      />
      <div className={styles.selectGrid}>
        <SelectField
          label="ORM / query layer"
          options={ormOptions(configuration.backend, configuration.database)}
          value={configuration.orm}
          onChange={(value) => wizard.update("orm", value)}
        />
        <SelectField
          label="Package manager / runtime"
          options={packageManagerOptions(configuration.backend)}
          value={configuration.packageManager}
          onChange={(value) => wizard.update("packageManager", value)}
        />
      </div>
    </div>
  );
}

function QualityStep({ wizard }: { wizard: WizardModel }) {
  const configuration = wizard.configuration;
  return (
    <OptionGrid
      options={qualityOptions(configuration.frontend, configuration.backend)}
      value={configuration.codeQuality}
      onChange={(value) => wizard.update("codeQuality", value)}
    />
  );
}

function AdvancedStep({ wizard }: { wizard: WizardModel }) {
  return (
    <div className={styles.advancedGrid}>
      {advancedOptions.map((option) => (
        <AdvancedOption
          key={option.value}
          option={option}
          selected={wizard.configuration.advancedOptions.includes(option.value)}
          onToggle={() => wizard.toggleAdvanced(option.value)}
        />
      ))}
    </div>
  );
}

function AdvancedOption({
  option,
  selected,
  onToggle,
}: {
  option: ProjectOption;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className={styles.advancedOption}
      type="button"
      role="switch"
      aria-checked={selected}
      onClick={onToggle}
    >
      <span>{option.label}</span>
      <span className={styles.switch} data-active={selected}>
        <span />
      </span>
    </button>
  );
}

function SummaryStep({ wizard }: { wizard: WizardModel }) {
  const items = summaryItems(wizard);
  return (
    <div className={styles.summaryGrid}>
      {items.map((item) => (
        <div className={styles.summaryItem} key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

type OptionGridProps = {
  options: ProjectOption[];
  value: string;
  onChange: (value: string) => void;
};

function OptionGrid({ options, value, onChange }: OptionGridProps) {
  return (
    <div className={styles.optionGrid}>
      {options.map((option) => (
        <button
          key={option.value}
          aria-pressed={option.value === value}
          className={styles.option}
          data-selected={option.value === value}
          disabled={option.disabled}
          type="button"
          onClick={() => onChange(option.value)}
        >
          <span className={styles.optionTop}>
            <strong>{option.label}</strong>
            {option.recommended ? <em>Recommended</em> : null}
          </span>
          <span>{option.description}</span>
        </button>
      ))}
    </div>
  );
}

type SelectFieldProps = {
  label: string;
  options: ProjectOption[];
  value: string;
  onChange: (value: string) => void;
};

function SelectField({ label, options, value, onChange }: SelectFieldProps) {
  const selected =
    options.find((option) => option.value === value) ?? options[0];
  return (
    <div className={styles.selectField}>
      <span id={selectLabelId(label)}>{label}</span>
      <Select value={selected?.value} onValueChange={onChange}>
        <SelectTrigger
          aria-labelledby={selectLabelId(label)}
          className="w-full border-white/10 bg-black/20 px-[0.75em] py-0 text-[1em] text-white/90 shadow-none hover:bg-white/[0.04] focus-visible:border-[#5275f5] focus-visible:ring-2 focus-visible:ring-[#5275f5]/20 data-[size=default]:h-[2.65em] [&_svg]:size-[1.2em]"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent
          className="z-[100] border-white/10 bg-[#181818] text-[clamp(0.625rem,0.8vw,0.8125rem)] text-[#f4f4f5] shadow-[0_1rem_3rem_rgba(0,0,0,0.55)]"
        >
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              className="text-[1em] focus:bg-white/10 focus:text-white [&_svg:not([class*='size-'])]:size-[1em]"
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <small>{selected?.description}</small>
    </div>
  );
}

function selectLabelId(label: string) {
  return `project-creation-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`;
}

function WizardFooter({ wizard }: { wizard: WizardModel }) {
  const summary = wizard.navigation.stepIndex === projectSteps.length - 1;
  const canContinue = Boolean(
    wizard.parentPath.trim() && wizard.projectName.trim(),
  );
  return (
    <footer className={styles.footer}>
      <button
        className={styles.secondaryButton}
        type="button"
        disabled={wizard.navigation.stepIndex === 0}
        onClick={wizard.navigation.back}
      >
        Back
      </button>
      <button
        className={styles.primaryButton}
        type="button"
        disabled={!canContinue}
        onClick={summary ? wizard.generation.start : wizard.navigation.next}
      >
        {summary ? <Sparkles aria-hidden="true" /> : null}
        {summary ? "Create project" : "Continue"}
      </button>
    </footer>
  );
}

function GenerationContent({ wizard }: { wizard: WizardModel }) {
  const stage = wizard.generation.stage;
  return (
    <div className={styles.generationBody}>
      <StepFrame
        title="Generating project"
        description="Blame is running a dedicated AI agent to generate and verify the codebase."
      >
        <div className={styles.generationStatus} aria-live="polite">
          {wizard.generation.finished ? (
            <CheckCircle2 aria-hidden="true" />
          ) : (
            <LoaderCircle className={styles.spinner} aria-hidden="true" />
          )}
          <strong>{stage?.label}</strong>
        </div>
        <GenerationTimeline activeLabel={stage?.label} />
        <pre className={styles.logs}>{wizard.generation.logs}</pre>
      </StepFrame>
    </div>
  );
}

function GenerationTimeline({ activeLabel }: { activeLabel?: string }) {
  const activeIndex = generationStages.findIndex(
    (stage) => stage.label === activeLabel,
  );
  return (
    <ol className={styles.timeline}>
      {generationStages.map((stage, index) => (
        <li
          key={stage.label}
          data-complete={index <= activeIndex}
          data-current={index === activeIndex}
        >
          <span />
          {stage.label}
        </li>
      ))}
    </ol>
  );
}

function GenerationFooter({ wizard }: { wizard: WizardModel }) {
  return (
    <footer className={styles.footer}>
      <button
        className={styles.secondaryButton}
        type="button"
        disabled={wizard.generation.running}
        onClick={wizard.restart}
      >
        Start over
      </button>
      <button
        className={styles.primaryButton}
        type="button"
        disabled={wizard.generation.running}
        onClick={wizard.generation.start}
      >
        <RotateCcw aria-hidden="true" /> Replay generation
      </button>
    </footer>
  );
}

function summaryItems(wizard: WizardModel) {
  const configuration = wizard.configuration;
  return [
    { label: "Path", value: `${wizard.parentPath}/${wizard.projectName}` },
    ...interfaceSummaryItems(configuration),
    ...runtimeSummaryItems(configuration),
  ];
}

function interfaceSummaryItems(configuration: ProjectConfiguration) {
  return [
    summaryOption("Frontend", frontendOptions, configuration.frontend),
    summaryOption("Styling", stylingOptions, configuration.styling),
    summaryOption(
      "UI library",
      uiLibraryOptions(configuration.frontend),
      configuration.uiLibrary,
    ),
  ];
}

function runtimeSummaryItems(configuration: ProjectConfiguration) {
  return [
    summaryOption(
      "Backend",
      backendOptions(configuration.frontend),
      configuration.backend,
    ),
    summaryOption("Database", databaseOptions, configuration.database),
    summaryOption(
      "ORM",
      ormOptions(configuration.backend, configuration.database),
      configuration.orm,
    ),
    summaryOption(
      "Package manager",
      packageManagerOptions(configuration.backend),
      configuration.packageManager,
    ),
    summaryOption(
      "Code quality",
      qualityOptions(configuration.frontend, configuration.backend),
      configuration.codeQuality,
    ),
  ];
}

function summaryOption(label: string, options: ProjectOption[], value: string) {
  return { label, value: optionLabel(options, value) };
}

function stylingOptionsFor(configuration: ProjectConfiguration) {
  return stylingOptions.map((option) => ({
    ...option,
    disabled:
      configuration.frontend === "none" ||
      (option.value !== "tailwind" &&
        requiresTailwind(configuration.uiLibrary)),
  }));
}

function updateConfiguration(
  current: ProjectConfiguration,
  key: ConfigurationKey,
  value: string,
) {
  if (key === "frontend") return configurationWithFrontend(current, value);
  if (key === "backend") return configurationWithBackend(current, value);
  if (key === "database") return configurationWithDatabase(current, value);
  if (key === "uiLibrary") {
    return {
      ...current,
      uiLibrary: value,
      styling: requiresTailwind(value) ? "tailwind" : current.styling,
    };
  }
  return { ...current, [key]: value };
}

function configurationWithFrontend(
  current: ProjectConfiguration,
  frontend: string,
) {
  const backend = recommendedBackend(frontend);
  return {
    ...current,
    frontend,
    styling: frontend === "none" ? "none" : "tailwind",
    uiLibrary: recommendedUiLibrary(frontend),
    backend,
    orm: "prisma",
    packageManager: "pnpm",
    codeQuality: frontend === "next" ? "eslint-prettier" : "biome",
  };
}

function configurationWithBackend(
  current: ProjectConfiguration,
  backend: string,
) {
  if (backend === "fastapi") {
    return { ...current, backend, orm: "sqlalchemy", packageManager: "uv" };
  }
  if (backend === "none")
    return { ...current, backend, orm: "none", packageManager: "pnpm" };
  return {
    ...current,
    backend,
    orm: current.database === "none" ? "none" : "prisma",
    packageManager: "pnpm",
  };
}

function configurationWithDatabase(
  current: ProjectConfiguration,
  database: string,
) {
  if (database === "none" || current.backend === "none") {
    return { ...current, database, orm: "none" };
  }
  const orm = current.backend === "fastapi" ? "sqlalchemy" : "prisma";
  return { ...current, database, orm };
}

function toggleAdvancedOption(current: ProjectConfiguration, value: string) {
  const active = current.advancedOptions.includes(value);
  const advancedOptions = active
    ? current.advancedOptions.filter((option) => option !== value)
    : [...current.advancedOptions, value];
  return { ...current, advancedOptions };
}

function generationLogs(stageIndex: number | null) {
  if (stageIndex === null) return "Waiting for agent output...";
  return generationStages
    .slice(0, stageIndex + 1)
    .map((stage) => stage.log)
    .join("");
}

function reducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
