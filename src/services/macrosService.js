function calculateBMR({ weight, height, age, gender }) {
    // gender: "М"/"Ж" (или "M"/"F")
    if (gender.toLowerCase().startsWith('m') || gender.toLowerCase().startsWith('м')) {
      return 10 * weight + 6.25 * height - 5 * age + 5;
    } else {
      return 10 * weight + 6.25 * height - 5 * age - 161;
    }
  }
  
  function activityFactor(level) {
    switch (level.toLowerCase()) {
      case 'низкий': return 1.2;
      case 'средний': return 1.55;
      case 'высокий': return 1.725;
      default: return 1.2;
    }
  }
  
  function adjustCaloriesForGoal(calories, goal) {
    // goal может быть lose/maintain/gain, а пользователь вводит "Сброс веса"/"Поддержание"/"Набор веса"
    switch (goal) {
      case 'lose':
        return Math.round(calories * 0.8);  // -20%
      case 'gain':
        return Math.round(calories * 1.2);  // +20%
      default:
        return Math.round(calories);
    }
  }
  
  function calculateMacros(calories) {
    // 30% protein, 30% fat, 40% carbs
    const p = calories * 0.30; 
    const f = calories * 0.30; 
    const c = calories * 0.40;
  
    return {
      protein: Math.round(p / 4),
      fat: Math.round(f / 9),
      carbs: Math.round(c / 4)
    };
  }
  
  module.exports = {
    calculateBMR,
    activityFactor,
    adjustCaloriesForGoal,
    calculateMacros
  };
  